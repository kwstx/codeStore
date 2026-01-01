import { pipeline } from '@xenova/transformers';

export class EmbeddingService {
    private static instance: EmbeddingService;
    private pipe: any = null;
    private modelName: string = 'Xenova/all-MiniLM-L6-v2';

    // LRU Cache Simulation using Map (maintains insertion order)
    private cache: Map<string, number[]> = new Map();
    private readonly CACHE_LIMIT = 100;

    private constructor() {
        // Private constructor for Singleton
    }

    public static getInstance(): EmbeddingService {
        if (!EmbeddingService.instance) {
            EmbeddingService.instance = new EmbeddingService();
        }
        return EmbeddingService.instance;
    }

    public async getEmbedding(text: string): Promise<number[]> {
        // 1. Check Cache
        if (this.cache.has(text)) {
            // Refresh LRU position
            const vector = this.cache.get(text);
            if (vector) {
                this.cache.delete(text);
                this.cache.set(text, vector);
                return vector;
            }
        }

        if (!this.pipe) {
            console.log(`[EmbeddingService] Loading model: ${this.modelName}`);
            // Force local loading or download on first run
            this.pipe = await pipeline('feature-extraction', this.modelName);
            console.log('[EmbeddingService] Model loaded.');
        }

        // Generate embedding
        const result = await this.pipe(text, { pooling: 'mean', normalize: true });
        const vector = Array.from(result.data) as number[];

        // 2. Set Cache
        if (this.cache.size >= this.CACHE_LIMIT) {
            // Remove oldest (first item in Map)
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(text, vector);

        return vector;
    }
}
