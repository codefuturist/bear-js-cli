import { Command, flags } from "@oclif/command";
import { bearExec } from "../utils/bear-exec";
import { NoteContents, NotesResponse } from "../types";
import { logNoteContents } from "../utils/log";
import cmdFlags from "../utils/flags";
import { argsWithPipe } from "../utils/read-pipe";

export default class UpdateText extends Command {
  static description = [
    "Update Bear notes with enhanced features and intuitive interface.",
    "Supports smart search, content enhancement, ID tracking, and file input.",
    "This is the enhanced version of add-text with better UX.",
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
    // Enhanced features from bear-notes.zsh
    "creation-date": cmdFlags["creation-date"],
    "add-id": cmdFlags["add-id"],
    "content-file": cmdFlags["content-file"],
    "search-term": flags.string({
      char: "s",
      description: "search term to find notes if no ID/title provided"
    }),
    "no-confirm": flags.boolean({
      char: "y",
      description: "skip confirmation prompts for automation"
    }),
    "view-updated": flags.boolean({
      char: "v",
      description: "view updated content after update"
    })
  };

  static args = [{ name: "content", description: "content to add to note" }];

  static examples = [
    '$ bear update "New content" --id ABC123',
    '$ bear update --search-term "meeting" --mode append',
    '$ bear update --content-file ./notes.md --creation-date --add-id',
    '$ bear update "Project update" --search-term "project" --timestamp --no-confirm',
    '$ bear update --title "Daily Notes" --creation-date --view-updated'
  ];

  async run() {
    const { args: cmdArgs, flags } = this.parse(UpdateText);
    let args = await argsWithPipe(UpdateText.args, cmdArgs, true);

    // Handle content from file
    if (flags["content-file"]) {
      try {
        const fs = require("fs");
        if (!fs.existsSync(flags["content-file"])) {
          this.error(`Content file not found: ${flags["content-file"]}`);
        }
        args.content = fs.readFileSync(flags["content-file"], "utf8");
        this.log(`📁 Content loaded from: ${flags["content-file"]}`);
      } catch (error) {
        this.error(`Error reading file: ${error}`);
      }
    }

    // Find note if not directly specified
    let noteId = flags.id;
    let noteTitle = flags.title;

    if (!noteId && !noteTitle && flags["search-term"]) {
      const searchResult = await this.findNoteBySearch(flags["search-term"], flags);
      if (searchResult) {
        noteId = searchResult.id;
        noteTitle = searchResult.title;
        this.log(`🎯 Found note: ${noteTitle}`);
      }
    }

    if (!noteId && !noteTitle) {
      this.error("No note specified. Use --id, --title, or --search-term to identify the note.");
    }

    // Check for existing embedded note ID if we have a note ID
    if (noteId) {
      const currentContent = await this.getNoteContent(noteId, flags);
      const detectedId = this.detectNoteId(currentContent);

      if (detectedId && detectedId !== noteId) {
        this.log(`⚠️  Found embedded note ID: ${detectedId}`);
        this.log(`⚠️  Current Bear note ID: ${noteId}`);
        this.log("These don't match! The note may have been duplicated or moved.");
        
        if (!flags["no-confirm"]) {
          this.log("💡 Consider using the embedded ID for consistency");
          // In a real interactive implementation, you'd prompt the user here
          this.log("Continuing with current note ID...");
        }
      } else if (detectedId && detectedId === noteId) {
        this.log("✅ Confirmed: Note has matching embedded ID");
      }

      // Show current content preview unless no-confirm
      if (!flags["no-confirm"] && currentContent) {
        this.log("\n📖 Current content preview:");
        this.log("─".repeat(50));
        this.log(currentContent.substring(0, 200) + (currentContent.length > 200 ? "..." : ""));
        this.log("─".repeat(50));
      }
    }

    // Enhance content with additional features  
    if (args.content) {
      args.content = this.enhanceContent(args.content, noteId || "", flags);
    }

    // Prepare parameters for Bear API
    const params = {
      text: args.content,
      id: noteId,
      title: noteTitle,
      mode: flags.mode || "append",
      timestamp: flags.timestamp ? "yes" : "no",
      "new-line": flags["new-line"] ? "yes" : "no",
      "open-note": flags["open-note"] ? "yes" : "no",
      "show-window": flags["show-window"] ? "yes" : "no",
      "new-window": flags["new-window"] ? "yes" : "no",
      edit: flags.edit ? "yes" : "no",
      header: flags.header,
      "exclude-trashed": flags["exclude-trashed"] ? "yes" : "no",
      tag: flags.tag
    };

    // Execute the update
    this.log(`\n🔄 Updating note with ${params.mode} mode...`);
    const response = await bearExec<NoteContents>("add-text", params);
    
    // Success message with feature indicators
    const features = [];
    if (flags["creation-date"]) features.push("creation date");
    if (flags["add-id"]) features.push("note ID");
    if (flags.timestamp) features.push("timestamp");
    
    if (features.length > 0) {
      this.log(`✅ Note updated successfully with ${features.join(", ")}!`);
    } else {
      this.log("✅ Note updated successfully!");
    }

    // View updated content if requested
    if (flags["view-updated"]) {
      this.log("\n📄 Updated content:");
      this.log("═".repeat(50));
      logNoteContents(response);
      this.log("═".repeat(50));
    } else {
      logNoteContents(response);
    }

    this.log("🎉 Update completed!");
  }

  private async findNoteBySearch(searchTerm: string, flags: any): Promise<{id: string, title: string} | null> {
    try {
      this.log(`🔍 Searching for notes containing: '${searchTerm}'`);

      const searchResponse = await bearExec<NotesResponse>("search", {
        term: searchTerm,
        token: flags.token,
        "show-window": "no"
      });

      // Parse the response - it might be a string or already parsed
      let notes;
      try {
        notes = typeof searchResponse.notes === 'string' 
          ? JSON.parse(searchResponse.notes) 
          : searchResponse.notes;
      } catch (error) {
        notes = searchResponse.notes;
      }

      if (!notes || notes.length === 0) {
        this.log(`❌ No notes found matching '${searchTerm}'`);
        return null;
      }

      // If only one result, use it
      if (notes.length === 1) {
        const note = notes[0];
        return { id: note.identifier, title: note.title };
      }

      // Multiple results - show list and use first one
      this.log(`\n📋 Found ${notes.length} notes:`);
      notes.slice(0, 5).forEach((note: any, index: number) => {
        this.log(`  ${index + 1}. ${note.title}`);
      });

      if (notes.length > 5) {
        this.log(`  ... and ${notes.length - 5} more`);
      }

      // Use first result (in interactive mode, you'd prompt for selection)
      const note = notes[0];
      this.log(`\n🎯 Using first result: ${note.title}`);
      return { id: note.identifier, title: note.title };
    } catch (error) {
      this.error(`Search error: ${error}`);
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