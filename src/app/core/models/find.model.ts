/** What the find panel searches for, and replaces with. */
export interface FindOptions {
  search: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}
