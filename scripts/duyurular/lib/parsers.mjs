// HTML / JSON listing parsers, one per site family. Each takes the listing response and the
// source and returns [{ title, url, published (Date|null), description?, deadlineText?, apiDeadline? }].
export const PARSERS = {}
