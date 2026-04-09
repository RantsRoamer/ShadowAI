#!/usr/bin/env node
'use strict';

const projectStore = require('../lib/projectStore.js');

function run() {
  const result = projectStore.repairAllProjectMemories();
  const changedItems = result.updated || [];

  console.log('Project memory repair complete.');
  console.log(`Scanned: ${result.scanned || 0}`);
  console.log(`Changed: ${result.changed || 0}`);
  console.log(`Skipped (missing memory): ${result.skipped || 0}`);

  if (changedItems.length) {
    console.log('\nUpdated files:');
    for (const item of changedItems) {
      const delta = item.afterBytes - item.beforeBytes;
      const sign = delta >= 0 ? '+' : '';
      console.log(`- ${item.id} (${item.name})`);
      console.log(`  ${item.path}`);
      console.log(`  bytes: ${item.beforeBytes} -> ${item.afterBytes} (${sign}${delta})`);
    }
  }
}

run();
