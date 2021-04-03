#!/bin/sh

# make a dependency graph of the files in this project
npx madge --dot src/* --exclude '^.*(index|types|helpers).*.ts$' > graph.dot
dot -Tpng graph.dot -o graph.png

