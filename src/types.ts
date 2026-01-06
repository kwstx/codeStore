export type ToolName = 'Cursor' | 'v0' | 'Copilot' | 'Unknown';
export type SessionStatus = 'success' | 'failed' | 'unknown';

export interface PromptVersion {
    id: string; // Unique ID for this version
    content: string;
    hash: string; // SHA-256 hash of the content
    timestamp: number;
    response?: string; // Optional response (if captured)
}

export interface VibeSession {
    id: string; // Unique ID
    workspaceId: string; // Workspace Identifier
    tool: ToolName;
    timestamp: number; // Creation time
    status: SessionStatus;
    prompts: PromptVersion[]; // Ordered list of prompt versions
}

export type DetectionMethod = 'regex' | 'diagnostic';

export interface MistakeFix {
    id: string;
    description: string; // e.g., "Diff to resolve"
    diff: string; // The specific change applied
    timestamp: number;
}

export interface MistakeFingerprint {
    id: string; // Unique ID for the fingerprint
    language: string; // e.g., 'typescript', 'python', 'all'
    detectionMethod: DetectionMethod;
    pattern: string; // Regex string or error code/substring
    count: number; // Number of times observed
    fixContext?: string; // Optional: Link to fix or description
    lastSeen: number; // Timestamp
    fixes?: MistakeFix[]; // List of recorded fixes
    ignored?: boolean; // User manually dismissed this warning
}

export interface CodeSnippet {
    id: string; // Hash of normalized content
    content: string;
    normalized: string;
    language: string;
    origin: 'paste' | 'generation' | 'unknown';
    sessionId?: string; // If known
    timestamp: number;
    useCount: number;
}

export interface SecurityRule {
    id: string;
    language: string; // 'javascript', 'typescript', 'python', 'any'
    pattern: string; // Regex string
    risk: string;
    alternative: string;
}
