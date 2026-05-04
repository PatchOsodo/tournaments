#!/bin/bash

PID=$(pgrep -f pocketbase)

if [ -z "$PID" ]; then
  echo "PocketBase is NOT running."
else
  echo "PocketBase is running (PID: $PID)"
  echo "Uptime: $(ps -o etime= -p $PID | tr -d ' ')"
fi
