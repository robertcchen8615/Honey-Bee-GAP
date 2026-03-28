# Honey-Bee-GAP

Honey Bee GAP Management

This repository includes a sample frontend in `index.html` for a honey bee voice-based GAP management system.

## Running with Docker

A `Dockerfile` is provided using Node.js 18 on Alpine Linux. To build the production image run:

```bash
docker build -t beekeeping-voice-system .
```

To start the container:

```bash
docker run -p 3000:3000 beekeeping-voice-system
```

For development you can use the `development` stage:

```bash
docker build -t beekeeping-voice-system-dev --target development .
docker run -p 3000:3000 beekeeping-voice-system-dev
```

## Environment Variables

Copy `.env.example` to `.env` and fill in your credentials before running the server locally.

```bash
cp .env.example .env
```

The application loads these values at startup using `dotenv`.
