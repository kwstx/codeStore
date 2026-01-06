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
        const lines = text.split('\n');

        for (const rule of SECURITY_RULES) {
            if (rule.language !== 'any' && rule.language !== language) {
                continue;
            }

            try {
                const regex = new RegExp(rule.pattern, 'g'); // Global flag

                // We need to scan line by line to get line numbers easily
                // Or scan full text and map indices to lines.
                // Scanning line-by-line is safer for simple regexes and reporting.
                lines.forEach((lineText, lineIndex) => {
                    let match;
                    // Reset regex state for each line if global? Or just create new RegExp?
                    // Safer to create new RegExp or use matchAll. 
                    const lineRegex = new RegExp(rule.pattern, 'gi');
                    while ((match = lineRegex.exec(lineText)) !== null) {
                        matches.push({
                            rule: rule,
                            line: lineIndex,
                            character: match.index,
                            matchText: match[0]
                        });
                    }
                });

            } catch (e) {
                console.error(`[SecurityScanner] Invalid regex for rule ${rule.id}:`, e);
            }
        }
        return matches;
    }
}
