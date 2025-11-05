import { DariTitleDeedAgent } from './dari-title-deed-agent.js';
import { DariAffectionPlanAgent } from './dari-affection-plan-agent.js';

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  agent: any;
}

export const agentRegistry: AgentInfo[] = [
  {
    id: 'dari-title-deed',
    name: 'Dari Title Deed Agent',
    description: 'Automates title deed generation and download from Dari platform using Excel data',
    icon: '📜',
    agent: DariTitleDeedAgent,
  },
  {
    id: 'dari-affection-plan',
    name: 'Dari Affection Plan Agent',
    description: 'Automates affection plan processing on Dari platform',
    icon: '❤️',
    agent: DariAffectionPlanAgent,
  },
];

export function getAgent(agentId: string): AgentInfo | undefined {
  return agentRegistry.find(agent => agent.id === agentId);
}

export function listAgents(): AgentInfo[] {
  return agentRegistry;
}
