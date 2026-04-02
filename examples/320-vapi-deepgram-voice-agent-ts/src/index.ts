import 'dotenv/config';
import express, { Request, Response } from 'express';
import { VapiClient } from '@vapi-ai/server-sdk';

const PORT = parseInt(process.env.PORT || '3000', 10);

if (!process.env.VAPI_API_KEY) {
  console.error('Error: VAPI_API_KEY environment variable is not set.');
  console.error('Copy .env.example to .env and add your keys.');
  process.exit(1);
}

const vapi = new VapiClient({ token: process.env.VAPI_API_KEY });

// Simulated order database — replace with your real data source
const ORDER_DB: Record<string, { status: string; eta: string; items: string[] }> = {
  '1001': { status: 'out_for_delivery', eta: '15 minutes', items: ['Large pepperoni pizza', 'Garlic bread'] },
  '1002': { status: 'preparing', eta: '30 minutes', items: ['Margherita pizza', 'Caesar salad'] },
  '1003': { status: 'delivered', eta: 'Already delivered', items: ['Hawaiian pizza'] },
};

function handleToolCall(name: string, args: Record<string, unknown>): string {
  if (name === 'check_order_status') {
    const orderNumber = String(args.order_number || '');
    const order = ORDER_DB[orderNumber];
    if (!order) {
      return JSON.stringify({ error: `Order ${orderNumber} not found` });
    }
    return JSON.stringify({ order_number: orderNumber, ...order });
  }
  return JSON.stringify({ error: `Unknown function: ${name}` });
}

export function createApp() {
  const app = express();
  app.use(express.json());

  // POST /webhook — Vapi sends server events here (function calls, status updates, end-of-call)
  app.post('/webhook', (req: Request, res: Response) => {
    const event = req.body;
    const type = event?.message?.type;

    console.log(`[webhook] ${type || 'unknown'}`);

    switch (type) {
      case 'function-call': {
        // ← THIS enables tool use: Vapi asks us to execute a function the LLM invoked
        const fnCall = event.message.functionCall;
        console.log(`[function] ${fnCall.name}(${JSON.stringify(fnCall.parameters)})`);
        const result = handleToolCall(fnCall.name, fnCall.parameters || {});
        console.log(`[function] result: ${result}`);
        res.json({ result });
        return;
      }

      case 'status-update':
        console.log(`[status] ${event.message.status} — ${event.message.endedReason || ''}`);
        break;

      case 'end-of-call-report':
        console.log(`[report] Duration: ${event.message.durationSeconds}s, Cost: $${event.message.cost}`);
        if (event.message.transcript) {
          console.log(`[report] Transcript: ${event.message.transcript.substring(0, 200)}...`);
        }
        break;

      case 'conversation-update':
        break;

      case 'speech-update':
        break;

      default:
        break;
    }

    res.status(200).send();
  });

  // GET /health — quick check that the server is running
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'vapi-deepgram-voice-agent' });
  });

  // POST /call — programmatically start a Vapi web call using the assistant
  app.post('/call', async (req: Request, res: Response) => {
    const assistantId = req.body?.assistantId || process.env.VAPI_ASSISTANT_ID;
    if (!assistantId) {
      res.status(400).json({ error: 'Missing assistantId in body or VAPI_ASSISTANT_ID env' });
      return;
    }

    try {
      const call = await vapi.calls.create({ assistantId }) as unknown as { id: string; status: string };
      console.log(`[call] Created: ${call.id}`);
      res.json({ callId: call.id, status: call.status });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[call] Error: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  POST /webhook  — Vapi server events (set this as your Server URL in the assistant)`);
    console.log(`  POST /call     — Start a web call`);
    console.log(`  GET  /health   — Health check`);
  });
}
