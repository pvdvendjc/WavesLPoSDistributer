#!/bin/bash
node=/usr/bin/node

echo "======================== START CorrectBlockWindowSize ======================="
echo `date`
echo

# increase stacks and usable memory to 4GB
$node --stack-size=65565 --max-old-space-size=8192 correctBlockWindowSize.js $1

echo
echo `date`
echo "====================== FINISHED CorrectBlockWindowSize ======================"
