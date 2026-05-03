#!/bin/bash

PID=$(pgrep -f ./pocketbase)

if [ -z "$PID" ]; then
  echo "PocketBase is not running."
else
  echo "Stopping PocketBase (PID: $PID)..."
  kill -9 $PID
  echo "PocketBase stopped."
fi
