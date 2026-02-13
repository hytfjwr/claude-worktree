export type PaneOptions = {
  keepFocus?: boolean; // If true, restore focus to the original pane after split
};

export type WeztermPane = {
  paneId: number;
  title: string;
  cwd: string;
};
