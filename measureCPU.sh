#!/bin/bash

set -e
set -o pipefail

 if [ -z $1 ]; then
     echo 'enter pid'
     exit 1
 fi
 if [ -z $2 ]; then
     echo 'enter snapshot times'
     exit 1
 fi
  if [ -z $3 ]; then
     echo 'enter interval in ms'
     exit 1
 fi

start=1
pid=$1
snapshotTimes=$2
interval=$3
#echo "${pid} ${snapshotTimes} ${interval}"
 result=""
for i in $(eval echo "{$start..$snapshotTimes}")
  do
  command=$(top -n 1 -p $pid -b|awk '{if(NR==8) print $9}')
  result+="${command}"
  result+="\n"
  sleep $(( interval / 1000 ))
  done
echo "${result}"
exit 0