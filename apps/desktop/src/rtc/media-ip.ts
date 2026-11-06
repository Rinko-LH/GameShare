// Experimental candidate restrictions are not a native socket/interface binding.
export function normalizedIp(address: string): string {
  try { return new URL(address.includes(':') ? `http://[${address}]` : `http://${address}`).hostname.replace(/^\[|\]$/g, '').toLowerCase(); }
  catch { return address.toLowerCase(); }
}

export function allowsMediaCandidate(candidate: string, selectedIp: string): boolean {
  const parts = candidate.replace(/^a=/, '').trim().split(/\s+/);
  return parts[6] === 'typ' && parts[7] === 'host' && normalizedIp(parts[4] ?? '') === normalizedIp(selectedIp);
}

export function restrictMediaSdp(sdp: string, selectedIp: string | null): string {
  if (!selectedIp) return sdp;
  return sdp.split(/\r?\n/).filter(line => !line.startsWith('a=candidate:') || allowsMediaCandidate(line, selectedIp)).join('\r\n');
}
