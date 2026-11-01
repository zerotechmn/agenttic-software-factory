export type NoteStatus = "queued" | "delivered";
export interface Note { id: number; role: string; text: string; status: NoteStatus }

/**
 * Which role a FORGE `note` event delivers an operator note to: text starting with `operator → <role>`.
 * Returns undefined for any other text. Pure; used by Director.
 */
export function noteRecipient(text: string): string | undefined {
  const m = /^\s*operator\s*(?:→|->)\s*([A-Za-z_]\w*)/.exec(text);
  return m ? m[1] : undefined;
}

/** In-memory notes per role (FORGE role: "dev" for every dev pod). */
export class NoteBook {
  private notes: Note[] = [];
  private seq = 0;

  add(role: string, text: string): Note {
    const n: Note = { id: ++this.seq, role, text, status: "queued" };
    this.notes.push(n);
    return n;
  }

  /** Mark the oldest queued note for `role` delivered. Returns it, or undefined. */
  deliver(role: string): Note | undefined {
    const n = this.notes.find((x) => x.role === role && x.status === "queued");
    if (n) n.status = "delivered";
    return n;
  }

  list(role: string): Note[] {
    return this.notes.filter((n) => n.role === role);
  }
}
