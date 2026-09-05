#!/bin/sh
cd "D:/!games"
echo "=== full 1..31 (god) ===" >> /tmp/na_b.log
node tools/test.js --bot --god --fast=4 --untilWave=31 --frames=200000 --timeout=7000000 --attempts=1 >> /tmp/na_b.log 2>&1
echo "=== endless 35..40 (god) ===" >> /tmp/na_b.log
node tools/test.js --bot --god --fast=4 --endless=35 --untilWave=40 --frames=200000 --timeout=7000000 --attempts=1 >> /tmp/na_b.log 2>&1
echo "=== full 1..31 (NO god) ===" >> /tmp/na_b.log
node tools/test.js --bot --fast=4 --untilWave=31 --frames=200000 --timeout=7000000 --attempts=1 >> /tmp/na_b.log 2>&1
echo "SUITE_B_DONE" >> /tmp/na_b.log
