export function extractTextPlain(raw: string): {
  text: string;
  htmlIgnored: boolean;
  attachments: { filename: string; mediaType: string; bytes: number; content?: string }[];
};

export function headerMap(headers: { get(name: string): string | null }): Record<string, string>;
