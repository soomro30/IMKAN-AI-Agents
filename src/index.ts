import { validateConfig } from './config.js';
import { AgentSelector } from './ui/agent-selector.js';
import { getAgent } from './agents/agent-registry.js';

async function main() {
  try {
    validateConfig();

    const args = process.argv.slice(2);
    let selectedAgent;

    if (args.length > 0 && args[0]) {
      selectedAgent = getAgent(args[0]);
      if (!selectedAgent) {
        console.error(`❌ Unknown agent: ${args[0]}`);
        console.log('Available agents: dari-title-deed, dari-affection-plan');
        process.exit(1);
      }
    } else {
      const selector = new AgentSelector();
      selectedAgent = await selector.selectAgent();
      selector.close();

      if (!selectedAgent) {
        process.exit(0);
      }
    }

    console.log('==============================================');
    console.log(`Starting ${selectedAgent.name}...`);
    console.log('==============================================\n');

    const AgentClass = selectedAgent.agent;
    const agent = new AgentClass();

    await agent.executeWorkflow();

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

main();
