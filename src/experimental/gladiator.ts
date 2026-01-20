import { LabsController } from './LabsController';

export class GladiatorArena {

    public static async challenge(userPrompt: string): Promise<string> {
        const controller = LabsController.getInstance();
        const model = controller.getSecondaryModel();

        try {
            const prompt = `You are "The Challenger", an adversarial AI model.
            The user asked: "${userPrompt.substring(0, 500)}"
            
            Your goal is to provide a BETTER, unrelenting alternative solution.
            Critique the standard approach and offer a more performant or robust version.
            
            Start your response with "// CHALLENGER APPROACH:"
            Code:`;

            const response = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
                    prompt: prompt,
                    stream: false
                })
            });

            if (response.ok) {
                const data = await response.json() as { response: string };
                return `\n\n<<<<<<< GLADIATOR CHALLENGER (${model}) >>>>>>>\n${data.response.trim()}\n<<<<<<< END CHALLENGER >>>>>>>`;
            }
        } catch (e) {
            return "";
        }
        return "";
    }
    public static async critiqueCode(code: string): Promise<string> {
        const controller = LabsController.getInstance();
        const model = controller.getSecondaryModel();

        try {
            const prompt = `You are "The Gladiator", a ruthless code critic.
            The user has provided this code snippet:
            
            ${code.substring(0, 1000)}

            Analyze it for performance, security, or style issues.
            If it is good, say "NO WEAKNESS DETECTED."
            If it is flawed, write a BETTER version.

            Start your response with "// GLADIATOR CRITIQUE:"
            Code:`;

            const response = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: model,
                    prompt: prompt,
                    stream: false
                })
            });

            if (response.ok) {
                const data = await response.json() as { response: string };
                return `\n\n<<<<<<< GLADIATOR CRITIQUE (${model}) >>>>>>>\n${data.response.trim()}\n<<<<<<< END CRITIQUE >>>>>>>`;
            }
        } catch (e) {
            return "";
        }
        return "";
    }
}
