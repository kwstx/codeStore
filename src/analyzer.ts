import * as path from 'path';

export interface PatternCandidate {
    language: string;
    content: string;
    projectPath: string; // approximate root
    filePath: string;
    startLine: number;
    endLine: number;
}

export class PatternAnalyzer {

    findPatterns(fileContent: string, filePath: string): PatternCandidate[] {
        const lines = fileContent.split('\n');
        const lineCount = lines.length;
        const ext = path.extname(filePath).substring(1); // .ts -> ts

        // heuristic: ignore very short files
        if (lineCount < 5) {
            return [];
        }

        // 1. Small files: Capture distinct unit
        if (lineCount <= 50) {
            return [{
                language: ext,
                content: fileContent,
                projectPath: path.dirname(filePath),
                filePath: filePath,
                startLine: 0,
                endLine: lineCount
            }];
        }

        // 2. Large files: Attempt to chunk
        // Basic language agnostic regex for function-like blocks:
        // Groups keywords like function, class, const/let (for arrow funcs), def (python)
        const chunks: PatternCandidate[] = [];

        // Regex to find Function or Class definitions (naive)
        // Matches: Start of line (or whitespace) + Keyword + Whitespace + Name
        const functionRegex = /((?:async\s+)?(?:function|class|const|let|var|def|public|private|protected)\s+[\w\d_]+)/g;

        let match;
        const indices: number[] = [];

        // Find all potential start indices
        while ((match = functionRegex.exec(fileContent)) !== null) {
            // Optional: Filter to ensure it's likely a definition (e.g. check for = or ( or { nearby?)
            // For MVP simpler is better.
            indices.push(match.index);
        }

        if (indices.length === 0) {
            // Fallback: Return whole file if no structure found
            return [{
                language: ext,
                content: fileContent,
                projectPath: path.dirname(filePath),
                filePath: filePath,
                startLine: 0,
                endLine: lineCount
            }];
        }

        // Create chunks based on indices
        for (let i = 0; i < indices.length; i++) {
            const start = indices[i];
            const end = (i + 1 < indices.length) ? indices[i + 1] : fileContent.length;
            const chunkContent = fileContent.substring(start, end).trim();

            const startLine = fileContent.substring(0, start).split('\n').length - 1;
            const endLine = fileContent.substring(0, end).split('\n').length - 1;

            // Filter tiny chunks/false positives (e.g. just a variable declaration)
            if (chunkContent.split('\n').length > 3) {
                chunks.push({
                    language: ext,
                    content: chunkContent,
                    projectPath: path.dirname(filePath),
                    filePath: filePath,
                    startLine: startLine,
                    endLine: endLine
                });
            }
        }

        return chunks;
    }
}
