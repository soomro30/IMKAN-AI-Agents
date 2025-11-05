import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { AgentInfo, listAgents } from '../agents/agent-registry.js';

export class AgentSelector {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({ input, output });
  }

  async selectAgent(): Promise<AgentInfo | null> {
    const agents = listAgents();

    console.clear();
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                                                              ║');
    console.log('║           🤖  AI AUTOMATION AGENT PLATFORM  🤖               ║');
    console.log('║                                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    console.log('Available Agents:\n');

    agents.forEach((agent, index) => {
      console.log(`  ${index + 1}. ${agent.icon}  ${agent.name}`);
      console.log(`     ${agent.description}\n`);
    });

    console.log(`  ${agents.length + 1}. ❌  Exit\n`);
    console.log('──────────────────────────────────────────────────────────────\n');

    const answer = await this.rl.question('Select an agent (enter number): ');
    const choice = parseInt(answer.trim());

    if (isNaN(choice) || choice < 1 || choice > agents.length + 1) {
      console.log('\n❌ Invalid selection. Please try again.\n');
      return this.selectAgent();
    }

    if (choice === agents.length + 1) {
      console.log('\n👋 Goodbye!\n');
      return null;
    }

    const selectedAgent = agents[choice - 1];
    console.log(`\n✓ Selected: ${selectedAgent.icon} ${selectedAgent.name}\n`);

    return selectedAgent;
  }

  close(): void {
    this.rl.close();
  }
}
