const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 80; // ms

export type Spinner = {
  stop: (finalMessage?: string) => void;
  fail: (message: string) => void;
};

export function startSpinner(message: string): Spinner {
  let frameIndex = 0;
  const write = (text: string) => {
    process.stdout.write(`\r\x1b[K${text}`);
  };

  write(`${FRAMES[0]} ${message}`);
  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % FRAMES.length;
    write(`${FRAMES[frameIndex]} ${message}`);
  }, INTERVAL);

  return {
    stop(finalMessage?: string) {
      clearInterval(timer);
      if (finalMessage) {
        write(`${finalMessage}\n`);
      } else {
        write(`✓ ${message}\n`);
      }
    },
    fail(errorMessage: string) {
      clearInterval(timer);
      write(`✗ ${errorMessage}\n`);
    },
  };
}
