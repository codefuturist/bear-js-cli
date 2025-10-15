import { Command, flags } from "@oclif/command";
import * as fs from "fs";
import * as path from "path";
import { bearExec } from "../utils/bear-exec";
import cmdFlags from "../utils/flags";

export default class BatchUpdate extends Command {
  static description = [
    "Batch update multiple Bear notes from markdown files in a directory.",
    "Automatically detects Note IDs in files and updates corresponding notes.",
    "Adds standardized footers with Created and Last Updated timestamps.",
    "Can process directories recursively."
  ].join("\n");

  static flags = {
    help: cmdFlags.help,
    directory: flags.string({
      char: "d",
      description: "directory containing markdown files to process",
      required: true,
    }),
    recursive: flags.boolean({
      char: "r",
      description: "recursively process subdirectories",
      default: false,
    }),
    "creation-date": cmdFlags["creation-date"],
    "add-id": cmdFlags["add-id"],
    "write-back": flags.boolean({
      char: "w",
      description: "write enhanced content back to source files",
      default: true,
    }),
    "dry-run": flags.boolean({
      char: "n",
      description: "show what would be updated without making changes",
      default: false,
    }),
    pattern: flags.string({
      char: "p",
      description: "file pattern to match (glob)",
      default: "*.md",
    }),
    mode: cmdFlags.mode,
  };

  async run() {
    const { flags } = this.parse(BatchUpdate);

    this.log("🚀 Bear Batch Update Starting...\n");
    this.log(`📁 Directory: ${flags.directory}`);
    this.log(`🔄 Recursive: ${flags.recursive ? "Yes" : "No"}`);
    this.log(`🔍 Pattern: ${flags.pattern}`);
    this.log(`🎯 Mode: ${flags.mode}`);
    this.log(`💾 Write-back: ${flags["write-back"] ? "Yes" : "No"}`);
    this.log(`🧪 Dry-run: ${flags["dry-run"] ? "Yes" : "No"}\n`);

    const resolvedDir = this.resolvePath(flags.directory);
    
    if (!fs.existsSync(resolvedDir)) {
      this.error(`Directory not found: ${flags.directory}\nResolved path: ${resolvedDir}`);
    }

    if (!fs.statSync(resolvedDir).isDirectory()) {
      this.error(`Path is not a directory: ${resolvedDir}`);
    }

    const files = this.findMarkdownFiles(resolvedDir, flags.recursive, flags.pattern);
    
    if (files.length === 0) {
      this.log(`⚠️  No markdown files found matching pattern: ${flags.pattern}`);
      return;
    }

    this.log(`📝 Found ${files.length} markdown file(s) to process\n`);

    let processed = 0;
    let updated = 0;
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const file of files) {
      try {
        const relativePath = path.relative(resolvedDir, file);
        this.log(`\n${"=".repeat(60)}`);
        this.log(`📄 Processing: ${relativePath}`);
        this.log(`${"=".repeat(60)}`);

        const content = fs.readFileSync(file, "utf8");
        const noteId = this.detectNoteId(content);

        if (!noteId) {
          this.log(`⏭️  Skipping: No Note ID found in file`);
          skipped++;
          continue;
        }

        this.log(`🔗 Note ID: ${noteId}`);

        if (flags["dry-run"]) {
          this.log(`🧪 DRY-RUN: Would update note ${noteId}`);
          processed++;
          continue;
        }

        // Check if note exists
        const exists = await this.noteExists(noteId);
        if (!exists) {
          this.log(`⚠️  Note ${noteId} does not exist - creating new note`);
          await this.createNote(file, noteId, content, flags);
          created++;
        } else {
          await this.updateNote(file, noteId, content, flags);
          updated++;
        }

        processed++;
      } catch (error) {
        this.log(`❌ Error processing ${file}: ${error}`);
        errors++;
      }
    }

    this.log(`\n${"=".repeat(60)}`);
    this.log("📊 BATCH UPDATE SUMMARY");
    this.log(`${"=".repeat(60)}`);
    this.log(`✅ Processed: ${processed}/${files.length}`);
    this.log(`🔄 Updated: ${updated}`);
    this.log(`🆕 Created: ${created}`);
    this.log(`⏭️  Skipped: ${skipped}`);
    this.log(`❌ Errors: ${errors}`);
    this.log(`${"=".repeat(60)}\n`);

    if (errors === 0 && processed === files.length) {
      this.log("🎉 All files processed successfully!");
    } else if (errors > 0) {
      this.warn(`⚠️  Completed with ${errors} error(s)`);
    }
  }

  private resolvePath(filePath: string): string {
    const expandedPath = filePath.startsWith("~")
      ? filePath.replace("~", process.env.HOME || "~")
      : filePath;
    return path.isAbsolute(expandedPath)
      ? expandedPath
      : path.resolve(process.cwd(), expandedPath);
  }

  private findMarkdownFiles(dir: string, recursive: boolean, pattern: string): string[] {
    const files: string[] = [];
    
    const processDir = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (recursive && !entry.name.startsWith(".")) {
            processDir(fullPath);
          }
        } else if (entry.isFile()) {
          // Simple glob matching (supports *.md, test*.md, etc.)
          const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
          if (regex.test(entry.name)) {
            files.push(fullPath);
          }
        }
      }
    };

    processDir(dir);
    return files.sort();
  }

  private detectNoteId(content: string): string | null {
    const match = content.match(/<!-- Note ID: ([A-F0-9-]+) -->/);
    return match ? match[1] : null;
  }

  private async noteExists(noteId: string): Promise<boolean> {
    try {
      await bearExec("open-note", {
        id: noteId,
        "show-window": "no",
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  private async updateNote(
    filePath: string,
    noteId: string,
    content: string,
    flags: any
  ): Promise<void> {
    let enhancedContent = content;

    // Add footer with Created + Last Updated
    if (flags["creation-date"] || flags["add-id"]) {
      enhancedContent = this.stripExistingFooter(enhancedContent);
      enhancedContent += this.buildUpdateFooter(noteId, flags["creation-date"], flags["add-id"]);
    }

    // Update the note in Bear
    await bearExec("add-text", {
      id: noteId,
      text: enhancedContent,
      mode: flags.mode || "replace_all",
      "show-window": "no",
    });

    this.log(`✅ Updated note in Bear`);

    // Write back to source file if requested
    if (flags["write-back"]) {
      fs.writeFileSync(filePath, enhancedContent, "utf8");
      this.log(`📝 Updated source file`);
    }
  }

  private async createNote(
    filePath: string,
    noteId: string,
    content: string,
    flags: any
  ): Promise<void> {
    let enhancedContent = this.stripExistingFooter(content);

    // For new notes, add Created only (no Last Updated)
    if (flags["creation-date"] || flags["add-id"]) {
      enhancedContent += this.buildNewNoteFooter(noteId, flags["creation-date"], flags["add-id"]);
    }

    // Create the note
    await bearExec("create", {
      text: enhancedContent,
      "show-window": "no",
    });

    this.log(`🆕 Created new note in Bear`);

    // Write back to source file if requested
    if (flags["write-back"]) {
      fs.writeFileSync(filePath, enhancedContent, "utf8");
      this.log(`📝 Updated source file`);
    }
  }

  private buildUpdateFooter(noteId: string, includeCreated: boolean, includeId: boolean): string {
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
      const updatedLine = `*Last Updated: ${formatDate(now)}*`;
      footer += `\n${createdLine}\n${updatedLine}`;
    }
    
    if (includeId) {
      const idLine = `<!-- Note ID: ${noteId} -->`;
      footer += `\n${idLine}`;
    }

    return footer;
  }

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
}
