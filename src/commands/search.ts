import { Command, flags } from "@oclif/command";
import { NotesResponse, NoteContents } from "../types";
import { bearExec } from "../utils/bear-exec";
import { logNotes } from "../utils/log";
import cmdFlags from "../utils/flags";
import { argsWithPipe } from "../utils/read-pipe";

export default class Search extends Command {
  static description = [
    "Fetch search results from Bear for all notes or for a specific tag.",
    "Enhanced with embedded ID detection feature.",
    "Returns list of unique note identifiers and note titles."
  ].join("\n");

  static flags = {
    help: cmdFlags.help,
    "show-window": cmdFlags["show-window"],
    tag: flags.string({ char: "t", description: "tag to search into" }),
    token: cmdFlags.token,
    "detect-embedded": cmdFlags["detect-embedded"]
  };

  static args = [{ name: "term", description: "string to search" }];

  async run() {
    const { args: cmdArgs, flags } = this.parse(Search);
    const args = await argsWithPipe(Search.args, cmdArgs);

    // Handle --detect-embedded mode
    if (flags["detect-embedded"]) {
      await this.detectEmbeddedIds(flags);
      return;
    }

    const params = { ...flags, ...args };

    const response = await bearExec<NotesResponse>("search", params);
    logNotes(response);
  }

  private async detectEmbeddedIds(flags: any) {
    this.log("🔍 Searching for notes with embedded note IDs...\n");

    try {
      // Get recent notes using today command
      const todayResponse = await bearExec<NotesResponse>("today", {
        token: flags.token,
        "show-window": "no"
      });

      // Parse the notes string response
      let notes;
      try {
        notes = JSON.parse(todayResponse.notes);
      } catch (error) {
        // If parsing fails, the notes might already be an array
        notes = todayResponse.notes;
      }
      
      if (!notes || notes.length === 0) {
        this.log("No recent notes found.");
        return;
      }

      let foundEmbedded = false;
      const notesToCheck = Array.isArray(notes) ? notes.slice(0, 10) : []; // Limit to 10

      for (const note of notesToCheck) {
        this.log(`Checking: ${note.title}...`);
        
        const noteContent = await this.getNoteContent(note.identifier, flags);
        const embeddedId = this.detectNoteId(noteContent);

        if (embeddedId) {
          foundEmbedded = true;
          const matchStatus = embeddedId === note.identifier ? "✅ Matching" : "⚠️  Mismatched";
          this.log(`📝 Found embedded ID in: ${note.title}`);
          this.log(`   Bear ID: ${note.identifier}`);
          this.log(`   Embedded ID: ${embeddedId} ${matchStatus}\n`);
        }
      }

      if (!foundEmbedded) {
        this.log("No notes found with embedded note IDs in recent notes.");
      } else {
        this.log("✅ Scan complete! Found notes with embedded IDs above.");
      }
    } catch (error) {
      this.error(`Error detecting embedded IDs: ${error}`);
    }
  }

  private async getNoteContent(noteId: string, flags: any): Promise<string> {
    try {
      const response = await bearExec<NoteContents>("open-note", {
        id: noteId,
        token: flags.token,
        "show-window": "no"
      });
      return response.note || "";
    } catch (error) {
      this.log(`⚠️  Warning: Could not read note content: ${error}`);
      return "";
    }
  }

  private detectNoteId(content: string): string | null {
    const match = content.match(/<!-- Note ID: ([A-F0-9-]+) -->/);
    return match ? match[1] : null;
  }
}
