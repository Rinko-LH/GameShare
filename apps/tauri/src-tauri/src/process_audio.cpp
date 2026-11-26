#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <wrl.h>

#include <cstdint>
#include <cstring>
#include <memory>
#include <new>

using Microsoft::WRL::ComPtr;

namespace {
class Activation final : public Microsoft::WRL::RuntimeClass<
    Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,
    IActivateAudioInterfaceCompletionHandler, Microsoft::WRL::FtmBase> {
 public:
  HANDLE ready = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_PENDING;
  ComPtr<IAudioClient> client;

  ~Activation() { if (ready) CloseHandle(ready); }

  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    ComPtr<IUnknown> device;
    HRESULT activation = E_FAIL;
    const HRESULT query = operation->GetActivateResult(&activation, device.GetAddressOf());
    result = FAILED(query) ? query : FAILED(activation) ? activation : device.As(&client);
    SetEvent(ready);
    return S_OK;
  }
};

struct Capture {
  ComPtr<IAudioClient> client;
  ComPtr<IAudioCaptureClient> input;
  HANDLE samples = nullptr;
  HANDLE process = nullptr;

  ~Capture() {
    if (client) client->Stop();
    input.Reset();
    client.Reset();
    if (samples) CloseHandle(samples);
    if (process) CloseHandle(process);
    CoUninitialize();
  }
};

constexpr DWORD channels = 2;
constexpr DWORD sample_rate = 48000;
}  // namespace

// The caller opens, reads and closes the capture on the same worker thread.
extern "C" HRESULT gs_open_process_audio(DWORD pid, Capture** result) {
  *result = nullptr;
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return hr;
  std::unique_ptr<Capture> capture(new (std::nothrow) Capture());
  if (!capture) {
    CoUninitialize();
    return E_OUTOFMEMORY;
  }
  capture->process = OpenProcess(SYNCHRONIZE, FALSE, pid);
  if (!capture->process) return HRESULT_FROM_WIN32(GetLastError());
  capture->samples = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!capture->samples) return HRESULT_FROM_WIN32(GetLastError());
  auto activation = Microsoft::WRL::Make<Activation>();
  if (!activation || !activation->ready) return E_OUTOFMEMORY;

  AUDIOCLIENT_ACTIVATION_PARAMS parameters{};
  parameters.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  parameters.ProcessLoopbackParams.TargetProcessId = pid;
  parameters.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT options{};
  options.vt = VT_BLOB;
  options.blob.cbSize = sizeof(parameters);
  options.blob.pBlobData = reinterpret_cast<BYTE*>(&parameters);
  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
                                   &options, activation.Get(), operation.GetAddressOf());
  if (FAILED(hr)) return hr;
  const DWORD wait = WaitForSingleObject(activation->ready, 4000);
  if (wait != WAIT_OBJECT_0) return HRESULT_FROM_WIN32(wait == WAIT_TIMEOUT ? ERROR_TIMEOUT : GetLastError());
  if (FAILED(activation->result)) return activation->result;
  capture->client = activation->client;

  WAVEFORMATEX format{};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = channels;
  format.nSamplesPerSec = sample_rate;
  format.wBitsPerSample = 16;
  format.nBlockAlign = channels * sizeof(int16_t);
  format.nAvgBytesPerSec = sample_rate * format.nBlockAlign;
  hr = capture->client->Initialize(AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
      0, 0, &format, nullptr);
  if (FAILED(hr)) return hr;
  hr = capture->client->GetService(IID_PPV_ARGS(capture->input.GetAddressOf()));
  if (FAILED(hr)) return hr;
  hr = capture->client->SetEventHandle(capture->samples);
  if (FAILED(hr)) return hr;
  hr = capture->client->Start();
  if (FAILED(hr)) return hr;
  *result = capture.release();
  return S_OK;
}

extern "C" HRESULT gs_read_process_audio(Capture* capture, int16_t* output,
                                          uint32_t capacity, uint32_t* frames) {
  *frames = 0;
  if (WaitForSingleObject(capture->process, 0) == WAIT_OBJECT_0) return S_FALSE;
  UINT32 next = 0;
  HRESULT hr = capture->input->GetNextPacketSize(&next);
  if (FAILED(hr)) return hr;
  if (!next) {
    HANDLE events[] = {capture->process, capture->samples};
    const DWORD wait = WaitForMultipleObjects(2, events, FALSE, 40);
    if (wait == WAIT_OBJECT_0) return S_FALSE;
    if (wait == WAIT_TIMEOUT) return S_OK;
    if (wait != WAIT_OBJECT_0 + 1) return HRESULT_FROM_WIN32(GetLastError());
    hr = capture->input->GetNextPacketSize(&next);
    if (FAILED(hr) || !next) return hr;
  }
  BYTE* data = nullptr;
  UINT32 count = 0;
  DWORD flags = 0;
  hr = capture->input->GetBuffer(&data, &count, &flags, nullptr, nullptr);
  if (FAILED(hr) || hr == AUDCLNT_S_BUFFER_EMPTY) return FAILED(hr) ? hr : S_OK;
  const size_t bytes = static_cast<size_t>(count) * channels * sizeof(int16_t);
  if (count <= capacity) {
    if (flags & AUDCLNT_BUFFERFLAGS_SILENT) std::memset(output, 0, bytes);
    else std::memcpy(output, data, bytes);
    *frames = count;
  }
  hr = capture->input->ReleaseBuffer(count);
  return count > capacity ? HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER) : hr;
}

extern "C" void gs_close_process_audio(Capture* capture) { delete capture; }
