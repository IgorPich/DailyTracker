const mode = process.argv[2]

if (mode === 'stdout' || mode === 'both') process.stdout.write('fixture stdout')
if (mode === 'stderr' || mode === 'both' || mode === 'nonzero') process.stderr.write('fixture stderr')
if (mode === 'nonzero') process.exitCode = 7
