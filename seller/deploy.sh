#!/bin/bash -l

tsc
tar -czvf seller-app-backend.tar.gz dist node_modules package.json package-lock.json .env*
scp seller-app-backend.tar.gz bitnami@15.207.220.151:~/app/saif/seller-app-backend
ssh bitnami@15.207.220.151 "cd ~/app/saif/seller-app-backend; tar -xzvf seller-app-backend.tar.gz"
