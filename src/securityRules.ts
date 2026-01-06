import { SecurityRule } from './types';

export const SECURITY_RULES: SecurityRule[] = [
    // JavaScript / TypeScript
    {
        id: 'no-eval',
        language: 'typescript',
        pattern: 'eval\\s*\\(',
        risk: 'Arbitrary code execution. Vulnerable to injection attacks.',
        alternative: 'Use JSON.parse() for data or safer parsing libraries.'
    },
    {
        id: 'no-eval-js',
        language: 'javascript',
        pattern: 'eval\\s*\\(',
        risk: 'Arbitrary code execution. Vulnerable to injection attacks.',
        alternative: 'Use JSON.parse() for data or safer parsing libraries.'
    },
    {
        id: 'inner-html',
        language: 'typescript',
        pattern: '\\.innerHTML\\s*=',
        risk: 'Cross-Site Scripting (XSS) vulnerability if input is unsanitized.',
        alternative: 'Use textContent or a sanitization library (e.g., DOMPurify).'
    },
    {
        id: 'inner-html-js',
        language: 'javascript',
        pattern: '\\.innerHTML\\s*=',
        risk: 'Cross-Site Scripting (XSS) vulnerability if input is unsanitized.',
        alternative: 'Use textContent or a sanitization library (e.g., DOMPurify).'
    },
    {
        id: 'document-write',
        language: 'javascript',
        pattern: 'document\\.write\\(',
        risk: 'Performance issues and possible XSS. Overwrites document in some contexts.',
        alternative: 'Use DOM manipulation methods (appendChild, etc.).'
    },

    // Python
    {
        id: 'py-exec',
        language: 'python',
        pattern: 'exec\\s*\\(',
        risk: 'Arbitrary code execution.',
        alternative: 'Refactor to avoid dynamic code execution.'
    },
    {
        id: 'py-eval',
        language: 'python',
        pattern: 'eval\\s*\\(',
        risk: 'Arbitrary code execution.',
        alternative: 'Use ast.literal_eval() for safe usage.'
    },
    {
        id: 'py-sql-injection',
        language: 'python',
        pattern: 'execute\\s*\\(.*[\'"]SELECT.*%s',
        risk: 'Potential SQL Injection via string formatting.',
        alternative: 'Use parameterized queries (?) instead of %s or format strings.'
    },

    // General / Secrets (Simple Heuristics)
    {
        id: 'aws-key',
        language: 'any',
        pattern: 'AKIA[0-9A-Z]{16}',
        risk: 'Hardcoded AWS Access Key.',
        alternative: 'Use environment variables or AWS Secrets Manager.'
    },
    {
        id: 'generic-secret',
        language: 'any',
        pattern: '(api_key|secret|password)\\s*=\\s*[\'"][A-Za-z0-9_\\-]{10,}[\'"]',
        risk: 'Potential Hardcoded Secret.',
        alternative: 'Use environment variables.'
    },
    {
        id: 'sql-destructive',
        language: 'any',
        pattern: '(DROP|DELETE|TRUNCATE)\\s+(TABLE|DATABASE|FROM)',
        risk: 'Destructive SQL command detected.',
        alternative: 'Verify isolation levels and backups before running.'
    }
];
