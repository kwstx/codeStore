import { SecurityRule } from './types';
import { SECURITY_RULES } from './securityRules';

export class SecurityScanner {
    private static instance: SecurityScanner;

    private constructor() { }

    public static getInstance(): SecurityScanner {
        if (!SecurityScanner.instance) {
            SecurityScanner.instance = new SecurityScanner();
        }
        return SecurityScanner.instance;
    }

    public scanText(text: string, language: string = 'any'): { rule: SecurityRule, line: number, character: number, matchText: string }[] {
        const matches: { rule: SecurityRule, line: number, character: number, matchText: string }[] = [];

        // Phase 9: Hardening - Strip comments and strings to avoid false positives
        const sanitizedText = this.stripCommentsAndStrings(text);

        // We use the sanitized text for matching, but report positions normally.
        // Since we ignore removed content by replacing with spaces, line counts/indices are preserved.
        const lines = sanitizedText.split('\n');

        for (const rule of SECURITY_RULES) {
            if (rule.language !== 'any' && rule.language !== language) {
                continue;
            }

            try {
                lines.forEach((lineText, lineIndex) => {
                    let match;
                    const lineRegex = new RegExp(rule.pattern, 'gi');
                    while ((match = lineRegex.exec(lineText)) !== null) {
                        matches.push({
                            rule: rule,
                            line: lineIndex,
                            character: match.index,
                            matchText: match[0] // Note: This might be '       ' if matched inside a stripped area? 
                            // Actually no, because we replaced the sensitive content (like "AWS_KEY") with spaces.
                            // So the rule regex (e.g. /AWS_ACCESS_KEY/) will NOT match the spaces.
                            // It will only match real code keys.
                            // Wait, if I replaced "AWS_KEY" with "       ", the regex /AWS_KEY/ won't match at all.
                            // Which is exactly what we want! We don't want to match inside strings/comments.
                        });
                    }
                });

            } catch (e) {
                console.error(`[SecurityScanner] Invalid regex for rule ${rule.id}:`, e);
            }
        }
        return matches;
    }

    private stripCommentsAndStrings(text: string): string {
        // Regex to match comments and strings
        // 1. Strings: Double quotes, Single quotes, Backticks (template literals)
        // 2. Comments: Single line (//), Multi line (/* */)

        // Advanced Regex (Careful with escaping)
        // Groups: 
        // 1. Strings: "...", '...', `...`  (Note: `...` allows multi-line, but our line-split might break if we not careful? 
        //    Actually, we replace with spaces, verifying newlines are preserved is key for line indexing.)

        // Ideally we iterate and replace.
        // Simplifying for MVP:

        return text.replace(/("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, (match) => {
            // Replace with spaces, BUT preserve newlines to keep line numbers in sync
            return match.replace(/[^\n]/g, ' ');
        });
    }
}
