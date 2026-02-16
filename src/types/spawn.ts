export type SpawnInteractiveOptions = {
  /** Shell command string to execute via `sh -c` */
  command: string;
  /** Working directory for the child process */
  cwd?: string;
};
