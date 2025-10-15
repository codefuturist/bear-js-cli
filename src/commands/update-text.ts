import { Command, flags } from "@oclif/command";
import { bearExec } from "../utils/bear-exec";
import { NoteContents, NotesResponse } from "../types";
import { logNoteContents } from "../utils/log";
import cmdFlags from "../utils/flags";
import { argsWithPipe } from "../utils/read-pipe";
import * as fs from "fs";
import * as path from "path";

export default class UpdateText extends Command {
  static description = [
    "Update Bear notes with enhanced features and intuitive interface.",
    "Supports smart search, content enhancement, ID tracking, and file input.",
    "This is the enhanced version of add-text with better UX.",
    "Beta encrypted notes can't be accessed with this call.",
    "Returns note's contents.",
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
      multiple: true,
    }),
    timestamp: cmdFlags.timestamp,
    title: cmdFlags.title,
    // Enhanced features from bear-notes.zsh
    "creation-date": cmdFlags["creation-date"],
    "add-id": cmdFlags["add-id"],
    "content-file": cmdFlags["content-file"],
    "search-term": flags.string({
      char: "s",
      description: "search term to find notes if no ID/title provided",
    }),
    "no-confirm": flags.boolean({
      char: "y",
      description: "skip confirmation prompts for automation",
    }),
    "view-updated": flags.boolean({
      char: "v",
      description: "view updated content after update",
    }),
    "write-back": flags.boolean({
      char: "w",
      description: "write enhanced content back to source file (updates footer in markdown)",
    }),
  };

  static args = [{ name: "content", description: "content to add to note", required: false }];

  static examples = [
    '$ bear update "New content" --id ABC123',
    '$ bear update --search-term "meeting" --mode append',
    "$ bear update --content-file ./notes.md --creation-date --add-id",
    "$ bear update --content-file ./notes.md --creation-date --add-id --write-back",
    '$ bear update "Project update" --search-term "project" --timestamp --no-confirm',
    '$ bear update --title "Daily Notes" --creation-date --view-updated',
  ];

  async run() {
    const { args: cmdArgs, flags } = this.parse(UpdateText);
    this.log(`🔍 Flags received: ${JSON.stringify(flags, null, 2)}`);
    this.log(`🔍 Args received: ${JSON.stringify(cmdArgs, null, 2)}`);
    // If a content file is provided, skip stdin reading entirely to avoid hangs
    let args = flags["content-file"]
      ? cmdArgs
      : await argsWithPipe(UpdateText.args, cmdArgs, false);

    // Handle content from file
    if (flags["content-file"]) {
      try {
        const fs = require("fs");
        const path = require("path");
        const rawPath: string = flags["content-file"] as unknown as string;
        const expandedPath = rawPath.startsWith("~")
          ? path.join(process.env.HOME || "", rawPath.slice(1))
          : rawPath;
        const resolvedPath = path.isAbsolute(expandedPath)
          ? expandedPath
          : path.resolve(process.cwd(), expandedPath);

        if (!fs.existsSync(resolvedPath)) {
          this.error(
            `Content file not found: ${rawPath}\nResolved path: ${resolvedPath}\nCWD: ${process.cwd()}`
          );
        }
        args.content = fs.readFileSync(resolvedPath, "utf8");
        this.log(`📁 Content loaded from: ${resolvedPath}`);
        this.log(`📄 Content length: ${args.content.length} characters`);
        this.log(`📄 Content preview: ${args.content.substring(0, 100)}...`);
      } catch (error) {
        this.error(`Error reading file: ${error}`);
      }
    }

    // Find note if not directly specified; prefer embedded Note ID if present in file
    let noteId = flags.id;
    let noteTitle = flags.title;

    if (!noteId && args.content) {
      const embedded = this.detectNoteId(args.content);
      if (embedded) {
        noteId = embedded;
        this.log(`🔗 Using embedded Note ID from file: ${noteId}`);
      }
    }

    if (!noteId && !noteTitle && flags["search-term"]) {
      const searchResult = await this.findNoteBySearch(
        flags["search-term"],
        flags
      );
      if (searchResult) {
        noteId = searchResult.id;
        noteTitle = searchResult.title;
        this.log(`🎯 Found note: ${noteTitle}`);
      }
    }

    if (!noteId && !noteTitle) {
      this.error(
        "No note specified. Use --id, --title, or --search-term to identify the note."
      );
    }

    // Check for existing embedded note ID if we have a note ID
    if (noteId) {
      const currentContent = await this.getNoteContent(noteId, flags);
      const detectedId = this.detectNoteId(currentContent);

      if (detectedId && detectedId !== noteId) {
        this.log(`⚠️  Found embedded note ID: ${detectedId}`);
        this.log(`⚠️  Current Bear note ID: ${noteId}`);
        this.log(
          "These don't match! The note may have been duplicated or moved."
        );

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
        this.log(
          currentContent.substring(0, 200) +
            (currentContent.length > 200 ? "..." : "")
        );
        this.log("─".repeat(50));
      }
    }

    // Enhance content with additional features
    if (args.content) {
      args.content = this.enhanceContent(args.content, noteId || "", flags);
      
      // Write enhanced content back to source file if requested
      if (flags["write-back"] && flags["content-file"]) {
        await this.writeBackToFile(flags["content-file"], args.content);
      }
    }

    // Prepare parameters for Bear API
    const params = {
      text: args.content,
      id: noteId,
      title: noteTitle,
      mode: flags.mode || "replace_all",
      timestamp: flags.timestamp ? "yes" : "no",
      "new-line": flags["new-line"] ? "yes" : "no",
      "open-note": flags["open-note"] ? "yes" : "no",
      "show-window": flags["show-window"] ? "yes" : "no",
      "new-window": flags["new-window"] ? "yes" : "no",
      edit: flags.edit ? "yes" : "no",
      header: flags.header,
      "exclude-trashed": flags["exclude-trashed"] ? "yes" : "no",
      tag: flags.tag,
    };

    // Remove optional params that are undefined to avoid sending empty query values
    Object.keys(params).forEach((key) => {
      if (params[key as keyof typeof params] === undefined) {
        delete params[key as keyof typeof params];
      }
    });

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

  private async findNoteBySearch(
    searchTerm: string,
    flags: any
  ): Promise<{ id: string; title: string } | null> {
    try {
      this.log(`🔍 Searching for notes containing: '${searchTerm}'`);

      const searchResponse = await bearExec<NotesResponse>("search", {
        term: searchTerm,
        token: flags.token,
        "show-window": "no",
      });

      // Parse the response - it might be a string or already parsed
      let notes;
      try {
        notes =
          typeof searchResponse.notes === "string"
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
        "show-window": "no",
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

    // If using standardized footer (creation-date AND add-id), use the new format
    if (flags["creation-date"] && flags["add-id"] && noteId) {
      // Strip any existing footer first
      enhancedContent = this.stripExistingFooter(enhancedContent);
      // Add standardized footer with Created + Last Updated + Note ID
      enhancedContent += this.buildStandardizedFooter(noteId);
      return enhancedContent;
    }

    // Legacy behavior: check if footer already exists to prevent duplicates
    const hasCreationDate = /---\s*\*Created:/.test(content);
    const hasNoteId = /<!-- Note ID:/.test(content);

    // Add creation date only if it doesn't already exist
    if (flags["creation-date"] && !hasCreationDate) {
      const creationDate = new Date().toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
      enhancedContent += `\n\n---\n*Created: ${creationDate}*`;
    }

    // Add note ID as HTML comment only if it doesn't already exist
    if (flags["add-id"] && noteId && !hasNoteId) {
      enhancedContent += `\n<!-- Note ID: ${noteId} -->`;
    }

    return enhancedContent;
  }

  /**
   * Build standardized footer with Created and Last Updated timestamps
   * Matches the format from auto-update-notes.zsh
   */
  private buildStandardizedFooter(noteId: string, createdDate?: Date): string {
    const now = new Date();
    const created = createdDate || now;
    
    const formatDate = (date: Date): string => {
      // Format: "Wed, Oct 15, 2025, 05:51 PM GMT+2"
      const locale = "en-US";
      const options: Intl.DateTimeFormatOptions = {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      };
      
      const formatted = date.toLocaleString(locale, options);
      const offset = this.buildGMTOffset(date);
      
      return `${formatted} ${offset}`;
    };

    const createdLine = `*Created: ${formatDate(created)}*`;
    const updatedLine = `*Last Updated: ${formatDate(now)}*`;
    const idLine = `<!-- Note ID: ${noteId} -->`;

    return `\n\n---\n${createdLine}\n${updatedLine}\n${idLine}`;
  }

  /**
   * Build GMT offset string like "GMT+2" or "GMT+2:30"
   */
  private buildGMTOffset(date: Date): string {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absOffset = Math.abs(offsetMinutes);
    const hours = Math.floor(absOffset / 60);
    const minutes = absOffset % 60;
    
    if (minutes === 0) {
      return `GMT${sign}${hours}`;
    } else {
      return `GMT${sign}${hours}:${minutes.toString().padStart(2, "0")}`;
    }
  }

  /**
   * Strip existing footer from content to prevent duplicates
   * Matches the awk logic from auto-update-notes.zsh
   */
  private stripExistingFooter(content: string): string {
    let cleaned = content;
    
    // Remove complete standardized footer: \n\n---\n*Created:...*\n*Last Updated:...*\n<!-- Note ID: ... -->
    // Also handles old format without Last Updated
    const footerPattern = /\n\n---\n\*Created:[^\n]*\n(\*Last Updated:[^\n]*\n)?<!-- Note ID: [A-F0-9-]+ -->\s*$/;
    cleaned = cleaned.replace(footerPattern, "");
    
    // Remove ALL standalone Note ID comments (anywhere in the file)
    // This prevents duplicates when the file already has: <!-- Note ID: ... -->
    cleaned = cleaned.replace(/\n*<!-- Note ID: [A-F0-9-]+ -->\s*/g, "");
    
    // Remove any trailing standalone separator lines
    cleaned = cleaned.replace(/\n\n---\s*$/g, "");
    
    // Clean up any excessive trailing newlines (keep max 1)
    cleaned = cleaned.replace(/\n\n+$/g, "\n");
    
    return cleaned;
  }

  /**
   * Write enhanced content back to the source file
   */
  private async writeBackToFile(filePath: string, content: string): Promise<void> {
    try {
      // Expand tilde and resolve path
      const expandedPath = filePath.startsWith("~")
        ? filePath.replace("~", process.env.HOME || "~")
        : filePath;
      const resolvedPath = path.isAbsolute(expandedPath)
        ? expandedPath
        : path.resolve(process.cwd(), expandedPath);

      // Write content back to file
      fs.writeFileSync(resolvedPath, content, "utf8");
      this.log(`📝 Enhanced content written back to: ${resolvedPath}`);
    } catch (error) {
      this.log(`⚠️  Warning: Could not write back to file: ${error}`);
    }
  }
}
