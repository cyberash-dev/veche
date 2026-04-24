import type { AdapterKind } from "../../meeting/domain/Participant.js";
import type { AgentAdapterPort } from "./AgentAdapterPort.js";

export interface AgentAdapterRegistryPort {
	get(kind: AdapterKind): AgentAdapterPort;
}
