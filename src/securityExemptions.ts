import * as fs from 'fs';
import * as path from 'path';

interface Exemption {
    id: string; // ruleId + file path hash? or content hash?
    ruleId: string;
    filePath: string;
    reason: string;
    timestamp: number;
}

export class SecurityExemptionManager {
    private static instance: SecurityExemptionManager;
    private exemptions: Map<string, Exemption> = new Map();
    private storagePath: string | null = null;

    private constructor() { }

    public static getInstance(): SecurityExemptionManager {
        if (!SecurityExemptionManager.instance) {
            SecurityExemptionManager.instance = new SecurityExemptionManager();
        }
        return SecurityExemptionManager.instance;
    }

    public init(storagePath: string) {
        this.storagePath = storagePath;
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }
        this.loadExemptions();
    }

    private getFilePath(): string {
        if (!this.storagePath) throw new Error("Storage path not initialized");
        return path.join(this.storagePath, 'security_exemptions.json');
    }

    private loadExemptions() {
        try {
            const file = this.getFilePath();
            if (fs.existsSync(file)) {
                const data = fs.readFileSync(file, 'utf8');
                const list = JSON.parse(data) as Exemption[];
                list.forEach(e => this.exemptions.set(this.getKey(e.ruleId, e.filePath), e));
            }
        } catch (e) {
            console.error("Failed to load exemptions", e);
        }
    }

    private saveExemptions() {
        if (!this.storagePath) return;
        try {
            const list = Array.from(this.exemptions.values());
            fs.writeFileSync(this.getFilePath(), JSON.stringify(list, null, 2));
        } catch (e) {
            console.error("Failed to save exemptions", e);
        }
    }

    private getKey(ruleId: string, filePath: string): string {
        return `${ruleId}|${filePath}`;
    }

    public addExemption(ruleId: string, filePath: string, reason: string) {
        const key = this.getKey(ruleId, filePath);
        this.exemptions.set(key, {
            id: key,
            ruleId,
            filePath,
            reason,
            timestamp: Date.now()
        });
        this.saveExemptions();
    }

    public isExempt(ruleId: string, filePath: string): boolean {
        return this.exemptions.has(this.getKey(ruleId, filePath));
    }
}
