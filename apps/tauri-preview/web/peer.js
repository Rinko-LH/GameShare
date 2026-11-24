export const { invoke } = window.__TAURI__.core;
export const { listen } = window.__TAURI__.event;

// 本机测试直接交换包含 ICE 候选的 SDP，无需公网 STUN 或信令服务。
export async function localDescription(peer, description) {
  await peer.setLocalDescription(description);
  if (peer.iceGatheringState !== 'complete') {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        peer.removeEventListener('icegatheringstatechange', check);
        reject(new Error('等待本机 ICE 候选超时'));
      }, 6000);
      function check() {
        if (peer.iceGatheringState !== 'complete') return;
        clearTimeout(timeout);
        peer.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
      peer.addEventListener('icegatheringstatechange', check);
      check();
    });
  }
  return peer.localDescription.toJSON();
}
