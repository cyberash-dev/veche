import { classifyResponse, type PassClassification } from "../domain/PassSignal.js";

export class ParsePassSignalUseCase {
	execute(raw: string): PassClassification {
		return classifyResponse(raw);
	}
}
