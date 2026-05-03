#!/bin/bash
cd '/home/tournaments'
nohup ./pocketbase serve --http=0.0.0.0:8090 &
 
