const SW_MSG_RETRIES = 3;
const SW_MSG_RETRY_DELAY_MS = 500;

export async function sendToSw<T = unknown>(message: unknown): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < SW_MSG_RETRIES; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      return response as T;
    } catch (error) {
      lastError = error;
      if (attempt < SW_MSG_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, SW_MSG_RETRY_DELAY_MS));
      }
    }
  }

  throw lastError;
}