# Agentic Sales

An Angular app that analyzes sales data with AI agents, built with [CopilotKit](https://copilotkit.ai), AG-UI, A2UI, and [Mastra](https://mastra.ai).

## Data

The app analyzes real purchases of the Google Merchandise Store from Google's public, obfuscated GA4 sample dataset in BigQuery (`bigquery-public-data.ga4_obfuscated_sample_ecommerce`), November 2020 to January 2021.

The aggregation server also serves an SVG image for every product and category under `/images`. The agent uses these images for A2UI views such as product cards.

## Configuration

The agent uses Gemma 4 26B, either from an Ollama server (default) or from Cloudflare Workers AI. Copy the template to `.env`:

```bash
cp .env.example .env
```

For Ollama, pull the model on the server (`ollama pull gemma4:26b-a4b-it-q8_0`) and set its URL if it is not `http://localhost:11434/v1`. For Cloudflare, set `MODEL_PROVIDER=cloudflare` and fill in your account id and an API token with Workers AI access:

```dotenv
MODEL_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

Settings:

| Variable                      | Default                     | Meaning                                                                                                                                                                          |
| ----------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MODEL_PROVIDER`              | `ollama`                    | `ollama` or `cloudflare`                                                                                                                                                         |
| `MODEL_THINKING`              | `false`                     | `true` turns on the model's thinking                                                                                                                                             |
| `MODEL_TEMPERATURE`           | `0`                         | Sampling temperature                                                                                                                                                             |
| `OLLAMA_BASE_URL`             | `http://localhost:11434/v1` | OpenAI-compatible endpoint of the Ollama server                                                                                                                                  |
| `OLLAMA_MODEL`                | `gemma4:26b-a4b-it-q8_0`    | Model name on the Ollama server                                                                                                                                                  |
| `RETURN_TOOL_RESULT_TO_MODEL` | `model_decides`             | What `runQuery` returns to the model besides showing the chart: `full` returns the data, `minimal` returns only a note, `model_decides` lets the model ask for the data per call |

## Running the app

```bash
npm install
npm start
```

`npm start` runs three processes side by side:

| Process            | Port | Command          |
| ------------------ | ---- | ---------------- |
| Aggregation server | 3000 | `npm run server` |
| Mastra agent       | 4111 | `npm run agent`  |
| Angular dev server | 4200 | `npm run client` |

## Evaluation

`npm run eval` sends the example prompts of both chats to the running agent, like the browser does, and checks the tool calls and the charts against reference values from the aggregation server. Start the app first.

```bash
npm run eval                          # all cases, 3 runs each
npm run eval -- --runs 1              # one run per case
npm run eval -- --case "per continent"  # cases whose name contains the text
```

The cases are in `eval/cases.ts`. Each run reports the model, the duration, failed tool calls and why a check failed.

## Branches

| Branch        | Content                                                    |
| ------------- | ---------------------------------------------------------- |
| `main`        | AG-UI-based dashboard                                      |
| `a2ui-custom` | AG-UI- and A2UI-based dashboard with a custom A2UI catalog |
