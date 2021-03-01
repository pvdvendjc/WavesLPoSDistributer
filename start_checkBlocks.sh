#!/bin/bash
node=/usr/bin/node

echo "======================== START COLLECTING ======================="
echo `date`
echo

# increase stacks and usable memory to 4GB
$node --stack-size=65565 --max-old-space-size=8192 checkBlocks.js

echo
echo `date`
echo "====================== FINISHED COLLECTING ======================"
#service waves start
