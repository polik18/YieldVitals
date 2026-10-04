const cryptoWorkerCode = `
  self.onmessage = async function(event) {
    const durationMs = event.data.duration || 1000;
    const workloadVersion = "aes-gcm-fixed-buffer-v2";
    const method = "aes-gcm-256-encrypt-decrypt-v1";
    const chunkBytes = 1024 * 1024;
    const nonceBytes = 12;

    try {
      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
      );
      const payload = new Uint8Array(chunkBytes);
      for (let index = 0; index < payload.length; index++)
        payload[index] = (index * 31 + 17) & 255;

      // A random 64-bit prefix plus a monotonic 32-bit counter guarantees no
      // nonce reuse within this run (including warm-up operations).
      const noncePrefix = crypto.getRandomValues(new Uint8Array(8));
      let nonceCounter = 0;
      const nextNonce = () => {
        if (nonceCounter > 0xffffffff) throw new Error("AES-GCM nonce counter exhausted");
        const iv = new Uint8Array(nonceBytes);
        iv.set(noncePrefix, 0);
        new DataView(iv.buffer).setUint32(8, nonceCounter++);
        return iv;
      };
      const encryptDecrypt = async () => {
        const iv = nextNonce();
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv }, key, payload
        );
        return new Uint8Array(await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          key,
          ciphertext
        ));
      };

      await encryptDecrypt();
      await encryptDecrypt();
      let lastPlaintext = null;
      let operations = 0;
      const startedAt = performance.now();
      while (performance.now() - startedAt < durationMs) {
        lastPlaintext = await encryptDecrypt();
        operations++;
      }
      const elapsedMs = performance.now() - startedAt;
      if (!lastPlaintext || lastPlaintext.length !== payload.length)
        throw new Error("AES-GCM output length mismatch");

      let checksum = 0;
      for (let index = 0; index < payload.length; index += 4096) {
        if (lastPlaintext[index] !== payload[index])
          throw new Error("AES-GCM round-trip verification failed");
        checksum = (checksum + lastPlaintext[index] + index) >>> 0;
      }
      const bytesProcessed = operations * chunkBytes * 2;
      const decimalMegabytesPerSecond =
        bytesProcessed / 1000000 / (elapsedMs / 1000);
      const warning = decimalMegabytesPerSecond > 10000
        ? "Exceeds the provisional 10000 MB/s plausibility threshold"
        : null;

      self.postMessage({
        success: true,
        score: Number(decimalMegabytesPerSecond.toFixed(2)),
        method,
        warning,
        elapsedMs,
        details: {
          workloadVersion,
          algorithm: "AES-GCM-256",
          direction: "encrypt-and-decrypt",
          chunkBytes,
          operations,
          bytesProcessed,
          nonceBytes,
          noncePolicy: "random-64-bit-prefix-plus-monotonic-32-bit-counter",
          checksum,
          warmupOperations: 2,
          dataUnit: "decimal MB (1000000 bytes)",
        },
      });
    } catch (error) {
      self.postMessage({ success: false, error: error.message });
    }
  };
`;

async function runCryptoTest(duration, runId, scope = activeBenchmarkScope) {
  setStatus("crypto", t("status_running_crypto"), "running");
  const blob = new Blob([cryptoWorkerCode], { type: "application/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  registerRunCleanup(() => URL.revokeObjectURL(workerUrl), scope);

  return new Promise((resolve, reject) => {
    const worker = createTrackedWorker(workerUrl, scope);
    worker.onmessage = (event) => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      if (isCancelledRun(runId)) return reject(new Error(t("error_cancelled")));

      if (!event.data.success) {
        reject(new Error(event.data.error));
        return;
      }

      const megabytesPerSecond = event.data.score;
      const resultElement = document.getElementById("res-crypto");
      setStatus("crypto", `${megabytesPerSecond} MB/s`, "done");
      resultElement.innerHTML = `${megabytesPerSecond} <span class="text-xs font-normal text-primary/60">MB/s</span>`;
      if (event.data.warning) {
        resultElement.classList.replace("text-primary", "text-yellow-400");
        document.getElementById("cryptoWarning").classList.remove("hidden");
      }

      resolve({
        value: megabytesPerSecond,
        method: event.data.method,
        samples: [megabytesPerSecond],
        durationMs: event.data.elapsedMs,
        ...(event.data.warning ? { warning: event.data.warning } : {}),
        details: event.data.details,
      });
    };
    worker.onerror = (error) => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      reject(new Error(`WebCrypto ${t("error_worker")}: ${error.message}`));
    };
    worker.postMessage({ duration });
  });
}
