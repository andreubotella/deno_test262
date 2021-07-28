export type FileExpectation = boolean | "strict" | "non-strict";

export interface FolderExpectation {
  [file: string]: FolderExpectation | FileExpectation;
}
