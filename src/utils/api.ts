import type { ExtractedClaim, ProgressEvent, VerifiedClaim } from '../types/factCheck';

export async function analyzePdfStream(
  file: File,
  onEvent: (event: ProgressEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/analyze', {
    method: 'POST',
    body: formData,
    signal,
  });

  if (!response.ok) {
    let errorMessage = `Upload failed with status ${response.status}.`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) errorMessage = data.error;
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    throw new Error('Server returned an unexpected response format instead of a live event stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const dataLines = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());

      if (dataLines.length === 0) continue;
      const jsonPayload = dataLines.join('\n');
      try {
        const parsed = JSON.parse(jsonPayload) as ProgressEvent;
        onEvent(parsed);
      } catch {
        // Ignore partial or heartbeat lines
      }
    }
  }
}

export async function fetchSamplePdfFile(): Promise<File> {
  const response = await fetch('/api/sample-pdf');
  if (!response.ok) {
    throw new Error('Could not retrieve the sample audit PDF from the server.');
  }
  const blob = await response.blob();
  return new File(
    [blob],
    'Meridian_Clean_Energy_and_Digital_Economy_Brief_2026.pdf',
    { type: 'application/pdf' }
  );
}

export async function reverifySingleClaimApi(claim: ExtractedClaim): Promise<VerifiedClaim> {
  const response = await fetch('/api/reverify-claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(claim),
  });

  const data = (await response.json()) as { claim?: VerifiedClaim; error?: string };
  if (!response.ok || !data.claim) {
    throw new Error(data.error || 'Failed to re-verify claim against live web sources.');
  }
  return data.claim;
}
