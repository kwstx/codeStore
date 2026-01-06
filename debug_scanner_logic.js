const SECURITY_RULES = [
    {
        id: 'no-eval',
        language: 'typescript',
        pattern: 'eval\\s*\\(',
        risk: 'Risk',
        alternative: 'Alt'
    }
];

function scanText(text, language = 'any') {
    const matches = [];
    const lines = text.split('\n');

    for (const rule of SECURITY_RULES) {
        if (rule.language !== 'any' && rule.language !== language) {
            continue;
        }

        try {
            console.log(`Checking rule ${rule.id} against "${text}"`);
            const regex = new RegExp(rule.pattern, 'g');
            console.log('Regex:', regex);

            lines.forEach((lineText, lineIndex) => {
                let match;
                // Re-create regex or reset lastIndex? 
                // 'gi' for case insensitive
                const lineRegex = new RegExp(rule.pattern, 'gi');
                while ((match = lineRegex.exec(lineText)) !== null) {
                    console.log('Match found!');
                    matches.push({
                        rule: rule,
                        line: lineIndex,
                        character: match.index,
                        matchText: match[0]
                    });
                }
            });

        } catch (e) {
            console.error(`Invalid regex`, e);
        }
    }
    return matches;
}

const results = scanText('const x = eval("foo");', 'typescript');
console.log('Results:', results);
