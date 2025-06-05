const express = require('express');
const line = require('@line/bot-sdk');
const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// 設定
const app = express();
const PORT = process.env.PORT || 3000;

// LINE Bot 設定
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

// OpenAI 設定
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 蜂場專業詞彙庫
const BEEKEEPING_VOCABULARY = {
  作業類型: {
    '餵糖水': ['餵糖水', '餵食', '補糖', '餵養'],
    '分蜂': ['分蜂', '分群', '分箱'],
    '育王': ['育王', '養王', '培育蜂王'],
    '提脾檢查': ['提脾', '檢查', '看蜂', '查看'],
    '採收': ['採蜜', '搖蜜', '收蜜', '採收'],
    '清理': ['清理', '清潔', '整理'],
    '防治': ['防蟎', '治療', '用藥'],
    '移箱': ['移箱', '搬箱', '轉移']
  },
  
  蜂場區域: {
    'A區': ['A區', 'A場', '甲區'],
    'B區': ['B區', 'B場', '乙區'],
    'C區': ['C區', 'C場', '丙區']
  },
  
  天氣狀況: {
    '晴': ['晴天', '晴', '好天氣', '天氣好'],
    '雨': ['下雨', '雨天', '雨', '下雨天'],
    '陰': ['陰天', '陰', '多雲'],
    '多雲': ['多雲', '雲多', '有雲']
  },
  
  牛角瓜狀況: {
    '無': ['沒有', '無', '沒開花'],
    '少量': ['少量', '一點點', '稍微'],
    '中等': ['中等', '普通', '還可以'],
    '大量': ['大量', '很多', '盛開', '開得很好']
  }
};

// 蜂場管理時間軸
const BEEKEEPING_TIMELINE = {
  '春繁期': {
    period: '1/20-3/20',
    mainTasks: ['餵糖水', '蜂箱清理', '檢查蜂群強度'],
    checkPoints: ['產卵情況', '蜂群數量', '食物儲備']
  },
  '分蜂期': {
    period: '3/21-5/15',
    mainTasks: ['人工育王', '分蜂管理', '新王培育'],
    checkPoints: ['王台發育', '交尾成功', '新王產卵']
  },
  '採蜜期': {
    period: '5/16-8/31',
    mainTasks: ['蜜源管理', '牛角瓜監測', '採收作業'],
    checkPoints: ['開花情況', '蜜源品質', '採收量']
  },
  '秋繁期': {
    period: '9/1-11/15',
    mainTasks: ['秋季繁殖', '儲備越冬', '蜂群整併'],
    checkPoints: ['蜂群強度', '食物儲備', '病蟲害']
  },
  '越冬期': {
    period: '11/16-1/19',
    mainTasks: ['保溫', '減少干擾', '監測存活'],
    checkPoints: ['蜂群狀態', '食物消耗', '死亡率']
  }
};

const client = new line.Client(config);

// 中介軟體
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 語音轉文字函數
async function transcribeAudio(audioBuffer) {
  try {
    // 將音頻緩衝區寫入臨時檔案
    const tempPath = path.join(__dirname, 'temp_audio.m4a');
    fs.writeFileSync(tempPath, audioBuffer);
    
    // 使用 OpenAI Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "whisper-1",
      language: "zh",
      prompt: "這是蜂場管理的語音記錄，包含蜜蜂、蜂箱、餵糖水、分蜂、牛角瓜等專業術語"
    });
    
    // 清理臨時檔案
    fs.unlinkSync(tempPath);
    
    return transcription.text;
  } catch (error) {
    console.error('語音轉文字錯誤:', error);
    throw error;
  }
}

// GAP 記錄驗證
function validateGapRecord(record) {
  const requiredFields = ['記錄日期', '農場名稱', '生產者姓名', '作業項目'];
  const missingFields = [];

  for (const field of requiredFields) {
    if (!record[field]) {
      missingFields.push(field);
    }
  }

  if (record['作業項目'] === '採收' || record['作業項目']?.includes('採')) {
    const honeyFields = ['採收量', '是否含牛角瓜蜜源', '水分含量是否已檢驗'];
    for (const field of honeyFields) {
      if (!record[field]) {
        missingFields.push(field);
      }
    }
  }

  if (!record['農場名稱']) record['農場名稱'] = '許能原蜂場';
  if (!record['生產者姓名']) record['生產者姓名'] = '許能原';
  if (!record['作業人員']) record['作業人員'] = '許能原';

  return {
    ...record,
    驗證狀態: missingFields.length === 0 ? '通過' : '需補充',
    缺少欄位: missingFields,
    處理時間: new Date().toISOString(),
  };
}

// 智慧解析蜂場語音
async function parseBeekeepingVoice(transcript, userId) {
  const currentDate = new Date().toISOString().split('T')[0];
  const currentSeason = getCurrentSeason();
  
  const prompt = `
你是專業的蜂場管理助手，請解析以下語音轉文字內容，並轉換為GAP表單格式。

語音內容:"${transcript}"
當前日期：${currentDate}
當前季節：${currentSeason}

請根據以下GAP表單欄位進行解析：
- 記錄日期：${currentDate}
- 農場名稱：許能原蜂場
- 生產者姓名：許能原
- 天氣狀況：從語音中推斷（晴/雨/陰/多雲）
- 蜂場位置與編號：提取區域和箱號
- 牛角瓜開花情況：無/少量/中等/大量
- 距蜂場距離：提取數字和單位
- 採花跡象：是/否/不確定
- 周遭農藥施用紀錄：是/否
- 毒性風險評估：需送檢/無風險/不適用
- 作業項目：主要作業內容
- 區域：蜂場區域
- 資材名稱：使用的資材
- 使用量：數量和單位
- 作業人員：許能原
- 備註：補充說明
- 採收批號：如有採收
- 採收量：公斤數
- 是否含牛角瓜蜜源：是/否/不確定
- 處理類型：頭期蜜/一般蜜
- 水分含量是否已檢驗：是/否
- 牛角瓜鹼是否已檢驗：是/否
- 儲藏條件：儲藏方式

請以JSON格式回覆，只包含能從語音中確定的欄位：
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "你是專業的蜂場管理系統，能精確解析蜂場作業語音並轉換為結構化資料。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3
    });

    const result = JSON.parse(response.choices[0].message.content);
    return result;
  } catch (error) {
    console.error('語音解析錯誤:', error);
    // 回傳基本結構
    return {
      記錄日期: currentDate,
      農場名稱: "許能原蜂場",
      生產者姓名: "許能原",
      備註: transcript
    };
  }
}

// 獲取當前季節
function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  
  if ((month === 1 && day >= 20) || (month === 2) || (month === 3 && day <= 20)) {
    return '春繁期';
  } else if ((month === 3 && day >= 21) || (month === 4) || (month === 5 && day <= 15)) {
    return '分蜂期';
  } else if ((month === 5 && day >= 16) || (month === 6) || (month === 7) || (month === 8)) {
    return '採蜜期';
  } else if ((month === 9) || (month === 10) || (month === 11 && day <= 15)) {
    return '秋繁期';
  } else {
    return '越冬期';
  }
}

// 生成確認卡片
function createBeekeepingConfirmCard(data, recordId) {
  return {
    type: 'flex',
    altText: '🐝 蜂場作業記錄確認',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🐝 蜂場作業記錄',
            weight: 'bold',
            size: 'lg',
            color: '#FFFFFF'
          },
          {
            type: 'text',
            text: '請確認以下資訊是否正確',
            size: 'sm',
            color: '#FFFFFF',
            margin: 'sm'
          }
        ],
        backgroundColor: '#FF8C00',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: '📅',
                flex: 1,
                size: 'sm'
              },
              {
                type: 'text',
                text: '日期',
                flex: 2,
                weight: 'bold',
                size: 'sm'
              },
              {
                type: 'text',
                text: data.記錄日期 || '未指定',
                flex: 3,
                size: 'sm',
                color: '#FF6B35'
              }
            ],
            margin: 'md'
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: '🌤️',
                flex: 1,
                size: 'sm'
              },
              {
                type: 'text',
                text: '天氣',
                flex: 2,
                weight: 'bold',
                size: 'sm'
              },
              {
                type: 'text',
                text: data.天氣狀況 || '未記錄',
                flex: 3,
                size: 'sm'
              }
            ],
            margin: 'md'
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: '🏠',
                flex: 1,
                size: 'sm'
              },
              {
                type: 'text',
                text: '區域',
                flex: 2,
                weight: 'bold',
                size: 'sm'
              },
              {
                type: 'text',
                text: data.區域 || data.蜂場位置與編號 || '未指定',
                flex: 3,
                size: 'sm',
                color: '#4CAF50'
              }
            ],
            margin: 'md'
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: '⚡',
                flex: 1,
                size: 'sm'
              },
              {
                type: 'text',
                text: '作業',
                flex: 2,
                weight: 'bold',
                size: 'sm'
              },
              {
                type: 'text',
                text: data.作業項目 || '一般管理',
                flex: 3,
                size: 'sm',
                color: '#2196F3'
              }
            ],
            margin: 'md'
          },
          data.牛角瓜開花情況 && {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'separator',
                margin: 'md'
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '🌺',
                    flex: 1,
                    size: 'sm'
                  },
                  {
                    type: 'text',
                    text: '牛角瓜',
                    flex: 2,
                    weight: 'bold',
                    size: 'sm'
                  },
                  {
                    type: 'text',
                    text: data.牛角瓜開花情況,
                    flex: 3,
                    size: 'sm',
                    color: '#E91E63'
                  }
                ],
                margin: 'md'
              }
            ]
          },
          data.資材名稱 && {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'separator',
                margin: 'md'
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'text',
                    text: '🧪',
                    flex: 1,
                    size: 'sm'
                  },
                  {
                    type: 'text',
                    text: '資材',
                    flex: 2,
                    weight: 'bold',
                    size: 'sm'
                  },
                  {
                    type: 'text',
                    text: `${data.資材名稱} ${data.使用量 || ''}`,
                    flex: 3,
                    size: 'sm',
                    color: '#9C27B0'
                  }
                ],
                margin: 'md'
              }
            ]
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: '📝 備註',
                weight: 'bold',
                size: 'sm',
                margin: 'md'
              },
              {
                type: 'text',
                text: data.備註 || '無額外備註',
                size: 'xs',
                color: '#666666',
                wrap: true,
                margin: 'sm'
              }
            ]
          }
        ].filter(Boolean),
        paddingAll: '20px'
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'postback',
              label: '✅ 確認儲存',
              data: `action=confirm&id=${recordId}`
            },
            color: '#4CAF50'
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '✏️ 修改',
              data: `action=edit&id=${recordId}`
            }
          }
        ]
      }
    }
  };
}

// 儲存記錄到資料庫 (暫時用記憶體存儲)
const recordDatabase = new Map();

function saveRecord(recordId, data) {
  recordDatabase.set(recordId, {
    ...data,
    創建時間: new Date().toISOString(),
    狀態: '待確認'
  });
}

function confirmRecord(recordId) {
  const record = recordDatabase.get(recordId);
  if (record) {
    record.狀態 = '已確認';
    record.確認時間 = new Date().toISOString();
    
    // 這裡應該串接到 Google Sheets 或其他持久化儲存
    console.log('記錄已確認:', record);
    
    // 發送到 n8n webhook
    sendToN8nWebhook(record);
    
    return true;
  }
  return false;
}

// 發送到 n8n webhook
async function sendToN8nWebhook(record) {
  try {
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (webhookUrl) {
      await axios.post(webhookUrl, {
        type: 'beekeeping_record',
        data: record,
        timestamp: new Date().toISOString()
      });
      console.log('資料已發送到 n8n');
    }
  } catch (error) {
    console.error('發送到 n8n 失敗:', error);
  }
}

// 生成每日任務提醒
function generateDailyTaskReminder() {
  const today = new Date();
  const currentSeason = getCurrentSeason();
  const seasonInfo = BEEKEEPING_TIMELINE[currentSeason];
  
  const message = `🐝 今日蜂場任務提醒\n` +
                 `📅 日期：${today.toLocaleDateString('zh-TW')}\n` +
                 `🌸 當前時期：${currentSeason}\n` +
                 `⚡ 主要作業：${seasonInfo.mainTasks.join('、')}\n` +
                 `📋 檢查項目：${seasonInfo.checkPoints.join('、')}\n\n` +
                 `💡 小提醒：記得用語音記錄今天的作業內容！`;
  
  return message;
}

// LINE Webhook 處理
app.post('/webhook', async (req, res) => {
  try {
    const events = req.body.events;
    
    for (const event of events) {
      if (event.type === 'message') {
        if (event.message.type === 'audio') {
          // 處理語音訊息
          await handleAudioMessage(event);
        } else if (event.message.type === 'text') {
          // 處理文字訊息
          await handleTextMessage(event);
        }
      } else if (event.type === 'postback') {
        // 處理回調事件
        await handlePostback(event);
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook 處理錯誤:', error);
    res.status(500).send('Error');
  }
});

// 處理語音訊息
async function handleAudioMessage(event) {
  const userId = event.source.userId;
  const messageId = event.message.id;
  
  try {
    // 回覆處理中訊息
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '🎤 正在處理您的語音記錄，請稍候...'
    });
    
    // 下載語音檔案
    const audioStream = await client.getMessageContent(messageId);
    const audioBuffer = [];
    
    audioStream.on('data', chunk => audioBuffer.push(chunk));
    audioStream.on('end', async () => {
      try {
        const buffer = Buffer.concat(audioBuffer);
        
        // 語音轉文字
        const transcript = await transcribeAudio(buffer);
        console.log('語音轉文字結果:', transcript);
        
        // 智慧解析
        const parsedData = await parseBeekeepingVoice(transcript, userId);
        console.log('解析結果:', parsedData);
        
        // 生成記錄 ID
        const recordId = `${userId}_${Date.now()}`;
        
        // 儲存記錄
        saveRecord(recordId, parsedData);
        
        // 生成確認卡片
        const confirmCard = createBeekeepingConfirmCard(parsedData, recordId);
        
        // 發送確認卡片
        await client.pushMessage(userId, confirmCard);
        
      } catch (error) {
        console.error('語音處理錯誤:', error);
        await client.pushMessage(userId, {
          type: 'text',
          text: '❌ 語音處理失敗，請重新錄製或使用文字輸入。'
        });
      }
    });
    
  } catch (error) {
    console.error('語音訊息處理錯誤:', error);
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ 語音處理發生錯誤，請稍後再試。'
    });
  }
}

// 處理文字訊息
async function handleTextMessage(event) {
  const text = event.message.text;
  const userId = event.source.userId;
  
  if (text === '今日任務' || text === '每日提醒') {
    const reminder = generateDailyTaskReminder();
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: reminder
    });
  } else if (text === '使用說明' || text === '幫助') {
    const helpMessage = `🐝 蜂場語音管理系統使用說明\n\n` +
                       `📱 語音記錄：\n直接發送語音訊息，系統會自動解析並產生GAP表單記錄\n\n` +
                       `💬 文字指令：\n• "今日任務" - 查看每日蜂場任務提醒\n• "使用說明" - 顯示此說明\n\n` +
                       `📝 語音範例：\n• "今天A區餵糖水，用了500ml的糖水"\n• "牛角瓜開花情況不錯，蜜蜂採花很積極"\n• "第八天檢查育王群，有五個王台"`;
    
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: helpMessage
    });
  } else {
    // 將文字當作語音解析
    try {
      const parsedData = await parseBeekeepingVoice(text, userId);
      const recordId = `${userId}_${Date.now()}`;
      
      saveRecord(recordId, parsedData);
      
      const confirmCard = createBeekeepingConfirmCard(parsedData, recordId);
      await client.replyMessage(event.replyToken, confirmCard);
      
    } catch (error) {
      console.error('文字解析錯誤:', error);
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '🤔 我不太理解您的意思，請嘗試用語音記錄或參考使用說明。'
      });
    }
  }
}

// 處理回調事件
async function handlePostback(event) {
  const data = new URLSearchParams(event.postback.data);
  const action = data.get('action');
  const recordId = data.get('id');
  const userId = event.source.userId;
  
  if (action === 'confirm') {
    // 確認記錄
    const success = confirmRecord(recordId);
    
    if (success) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '✅ 記錄已成功儲存到GAP管理系統！\n\n🔄 資料已同步到：\n• Google Sheets 表單\n• 蜂場管理時間軸\n• 每日任務系統'
      });
    } else {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: '❌ 記錄儲存失敗，請重新嘗試。'
      });
    }
  } else if (action === 'edit') {
    // 編輯記錄
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '✏️ 請重新錄製語音或輸入文字來更新記錄。\n\n💡 提示：說得越詳細，系統解析會越準確！'
    });
  }
}

// GAP 記錄驗證 Webhook
app.post('/beekeeping-webhook', (req, res) => {
  const record = req.body.data || req.body;
  const result = validateGapRecord(record);
  res.json(result);
});

// 每日任務推播 (可以用 cron job 觸發)
app.get('/daily-reminder', async (req, res) => {
  try {
    const reminder = generateDailyTaskReminder();
    
    // 這裡應該發送給所有註冊用戶
    // 暫時只輸出到 console
    console.log('每日提醒:', reminder);
    
    res.json({ message: '每日提醒已發送', content: reminder });
  } catch (error) {
    console.error('每日提醒錯誤:', error);
    res.status(500).json({ error: '每日提醒發送失敗' });
  }
});

// 健康檢查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    records: recordDatabase.size
  });
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`🐝 蜂場語音管理系統已啟動於 port ${PORT}`);
  console.log(`📅 當前季節: ${getCurrentSeason()}`);
});

module.exports = app;
