import { Command, flags } from "@oclif/command";
import { bearExec } from "../utils/bear-exec";
import { NoteContents } from "../types";
import { logNoteContents } from "../utils/log";
import cmdFlags from "../utils/flags";
import { argsWithPipe } from "../utils/read-pipe";

export default class AddText extends Command {
  static description = [
    "Append or prepend text to a note identified by its title or id.",
    "Enhanced with creation date, note ID embedding, and file input support.",
    "Beta encrypted notes can't be accessed with this call.",
    "Returns note's contents."
  ].join("\n");

  static flags = {
    help: cmdFlags.help,
    edit: cmdFlags.edit,
    "exclude-trashed": cmdFlags["exclude-trashed"],
    header: cmdFlags.header,
    id: cmdFlags.id,
    mode: cmdFlags.mode,
    "new-line": cmdFlags["new-line"],
    "new-window": cmdFlags["new-window"],
    "open-note": cmdFlags["open-note"],
    "show-window": cmdFlags["show-window"],
    tag: flags.string({
      char: "t",
      description: "tag for note",
      multiple: true
    }),
    timestamp: cmdFlags.timestamp,
    title: cmdFlags.title,
    // Enhanced features
    "creation-date": cmdFlags["creation-date"],
    "add-id": cmdFlags["add-id"],
    "content-file": cmdFlags["content-file"]
  };

  static args = [{ name: "text", description: "note body" }];

  async run() {
    const { args: cmdArgs, flags } = this.parse(AddText);
    let args = await argsWithPipe(AddText.args, cmdArgs, true);

    // Handle content from file
    if (flags["content-file"]) {
      try {
        const fs = require("fs");
        if (!fs.existsSync(flags["content-file"])) {
          this.error(`Content file not found: ${flags["content-file"]}`);
        }
        args.text = fs.readFileSync(flags["content-file"], "utf8");
      } catch (error) {
        this.error(`Error reading file: ${error}`);
      }
    }

    // Enhance content with additional features  
    if (args.text) {
      args.text = this.enhanceContent(args.text, flags.id || "", flags);
    }

    const params = { ...args, ...flags };

    const response = await bearExec<NoteContents>("add-text", params);
    
    if (flags["creation-date"] || flags["add-id"]) {
      this.log("✅ Note updated with enhanced features!");
    }
    
    logNoteContents(response);
  }

  private enhanceContent(content: string, noteId: string, flags: any): string {
    let enhancedContent = content;

    // Add creation date
    if (flags["creation-date"]) {
      const creationDate = new Date().toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric", 
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short"
      });
      enhancedContent += `\n\n---\n*Created: ${creationDate}*`;
    }

    // Add note ID as HTML comment
    if (flags["add-id"] && noteId) {
      enhancedContent += `\n<!-- Note ID: ${noteId} -->`;
    }

    return enhancedContent;
  }
}
