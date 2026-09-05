#!/bin/sh
cd "D:/!games"
for b in page encore lurker dimmer; do
  echo "=== boss $b ===" >> /tmp/na_a.log
  node tools/test.js --boss=$b --bot --god --fast=6 --frames=3000 --domcheck --attempts=1 --timeout=900000 >> /tmp/na_a.log 2>&1
done
echo "=== stress ===" >> /tmp/na_a.log
node tools/test.js --stress --frames=900 --attempts=2 >> /tmp/na_a.log 2>&1
echo "=== wave28 prof ===" >> /tmp/na_a.log
node tools/test.js --bot --god --fast=1 --wave=28 --frames=3000 --prof --attempts=2 >> /tmp/na_a.log 2>&1
echo "SUITE_A_DONE" >> /tmp/na_a.log
