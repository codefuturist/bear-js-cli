import { Command, flags } from "@oclif/command";
import * as fs from "fs";
import * as path from "path";
import { bearExec } from "../utils/bear-exec";
import { NoteId } from "../types";
import { logNoteId } from "../utils/log";
import cmdFlags from "../utils/flags";
import { argsWithPipe } from "../utils/read-pipe";

export default class Create extends Command {
  static description = [
    "Create a new note. Empty notes are not allowed.",
    "Returns unique note identifier of new note."
  ].join("\n");

  static flags = {
    edit: cmdFlags.edit,
    file: cmdFlags.file,
    filename: cmdFlags.filename,
    help: cmdFlags.help,
    "new-window": cmdFlags["new-window"],
    "open-note": cmdFlags["open-note"],
    pin: cmdFlags.pin,
    "show-window": cmdFlags["show-window"],
    tag: flags.string({
      char: "t",
      description: "tag for note",
      multiple: true
    }),
    timestamp: cmdFlags.timestamp,
    title: cmdFlags.title,
    // Enhanced features for footer
    "creation-date": cmdFlags["creation-date"],
    "add-id": cmdFlags["add-id"],
    "content-file": cmdFlags["content-file"],
    "write-back": flags.boolean({
      char: "w",
      description: "write enhanced content back to source file (updates footer in markdown)",
    }),
  };

  static args = [
    {
      name: "text",
      description: "note body"
    }
  ];

  async run() {
    const { flags, args: cmdArgs } = this.parse(Create);
    const args = await argsWithPipe(Create.args, cmdArgs);
    
    // Handle content from file
    if (flags["content-file"]) {
      try {
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
        args.text = fs.readFileSync(resolvedPath, "utf8");
        this.log(`📁 Content loaded from: ${resolvedPath}`);
      } catch (error) {
        this.error(`Error reading file: ${error}`);
      }
    }

    // Check if file already has an embedded Note ID
    // If it does, use update-text behavior instead of create
    if (args.text) {
      const embeddedId = this.detectNoteId(args.text);
      if (embeddedId) {
        this.log(`🔗 Found embedded Note ID: ${embeddedId}`);
        this.log(`📝 File already has a Note ID - updating existing note instead of creating new one`);
        
        // Use update-text behavior
        await this.updateExistingNote(embeddedId, args.text, flags);
        return;
      }
    }

    const { tag = [], file, "content-file": contentFile, "write-back": writeBack, ...restFlags } = flags;

    type Params = typeof restFlags & { file?: string; tags: string };
    const params: Params = { ...args, ...restFlags, tags: tag.join(",") };

    // bear requires base64 encoding of file attachements
    if (file) {
      try {
        const fileContents = fs.readFileSync(
          path.join(process.cwd(), file),
          "utf8"
        );
        params.file = Buffer.from(fileContents).toString("base64");
      } catch (error) {
        this.error("There was an error accessing that file");
      }
    }

    // Step 1: Create the note to get an ID
    this.log("🆕 Creating new note...");
    const result = await bearExec<NoteId>("create", params);
    const noteId = result.identifier;
    this.log(`✅ Note created with ID: ${noteId}`);

    // Step 2: If footer enhancements are requested, update the note with footer
    if ((flags["creation-date"] || flags["add-id"]) && noteId) {
      this.log("📝 Adding footer to note...");
      
      let enhancedContent = args.text || "";
      
      // Add footer for new notes (Created only, no Last Updated for new notes)
      if (flags["creation-date"] || flags["add-id"]) {
        enhancedContent = this.stripExistingFooter(enhancedContent);
        enhancedContent += this.buildNewNoteFooter(noteId, flags["creation-date"], flags["add-id"]);
      }

      // Update the note with the footer
      await bearExec("add-text", {
        id: noteId,
        text: enhancedContent,
        mode: "replace_all",
        "show-window": "no",
      });

      // Write back to source file if requested
      if (writeBack && contentFile) {
        await this.writeBackToFile(contentFile as string, enhancedContent);
      }

      this.log("✅ Footer added successfully!");
    }

    logNoteId(result);
  }

  /**
   * Build footer for NEW notes (Created only, no Last Updated)
   */
  private buildNewNoteFooter(noteId: string, includeCreated: boolean, includeId: boolean): string {
    const now = new Date();
    
    const formatDate = (date: Date): string => {
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

    let footer = "\n\n---";
    
    if (includeCreated) {
      const createdLine = `*Created: ${formatDate(now)}*`;
      footer += `\n${createdLine}`;
    }
    
    if (includeId) {
      const idLine = `<!-- Note ID: ${noteId} -->`;
      footer += `\n${idLine}`;
    }

    return footer;
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
   */
  private stripExistingFooter(content: string): string {
    let cleaned = content;
    
    // Remove complete standardized footer
    const footerPattern = /\n\n---\n\*Created:[^\n]*\n(\*Last Updated:[^\n]*\n)?<!-- Note ID: [A-F0-9-]+ -->\s*$/;
    cleaned = cleaned.replace(footerPattern, "");
    
    // Remove ALL standalone Note ID comments (anywhere in the file)
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
      const expandedPath = filePath.startsWith("~")
        ? filePath.replace("~", process.env.HOME || "~")
        : filePath;
      const resolvedPath = path.isAbsolute(expandedPath)
        ? expandedPath
        : path.resolve(process.cwd(), expandedPath);

      fs.writeFileSync(resolvedPath, content, "utf8");
      this.log(`📝 Enhanced content written back to: ${resolvedPath}`);
    } catch (error) {
      this.log(`⚠️  Warning: Could not write back to file: ${error}`);
    }
  }

  /**
   * Detect Note ID from content
   */
  private detectNoteId(content: string): string | null {
    const match = content.match(/<!-- Note ID: ([A-F0-9-]+) -->/);
    return match ? match[1] : null;
  }

  /**
   * Update existing note (when Note ID is detected in file)
   */
  private async updateExistingNote(noteId: string, content: string, flags: any): Promise<void> {
    this.log(`🔄 Updating existing note: ${noteId}`);
    
    let enhancedContent = content;
    
    // If footer enhancements are requested, add them
    if (flags["creation-date"] || flags["add-id"]) {
      enhancedContent = this.stripExistingFooter(enhancedContent);
      
      // For updates, include both Created and Last Updated
      const now = new Date();
      const formatDate = (date: Date): string => {
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

      let footer = "\n\n---";
      
      if (flags["creation-date"]) {
        const createdLine = `*Created: ${formatDate(now)}*`;
        const updatedLine = `*Last Updated: ${formatDate(now)}*`;
        footer += `\n${createdLine}\n${updatedLine}`;
      }
      
      if (flags["add-id"]) {
        const idLine = `<!-- Note ID: ${noteId} -->`;
        footer += `\n${idLine}`;
      }

      enhancedContent += footer;
    }

    // Update the note
    await bearExec("add-text", {
      id: noteId,
      text: enhancedContent,
      mode: "replace_all",
      "show-window": "no",
    });

    // Write back to source file if requested
    if (flags["write-back"] && flags["content-file"]) {
      await this.writeBackToFile(flags["content-file"] as string, enhancedContent);
    }

    this.log(`✅ Note updated successfully!`);
    
    // Log the note ID for consistency (title is optional in this context)
    logNoteId({ identifier: noteId, title: "" });
  }
}
