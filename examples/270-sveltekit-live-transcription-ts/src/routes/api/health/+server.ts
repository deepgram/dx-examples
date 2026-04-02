import { json } from '@sveltejs/kit';

export function GET() {
	return json({ status: 'ok', service: 'sveltekit-live-transcription' });
}
