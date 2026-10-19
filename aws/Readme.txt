aws cloudformation deploy \
  --template-file aws/template.yaml \
  --stack-name snappy-study-api \
  --region eu-central-1 \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides OpenAIApiKey=k-proj-vTXpui2DrKo1cXmJw0KbsrhniIEXTMXb5qp6he1j65X1ibDspfBfKuNp2CesuxyWXqEhu9ACBTT3BlbkFJU_u6wMSQLD7iHT3qOlD3T-1GvA_eQ1OWgu6OruogBD17lgy_2OQ3N0EXB5G3ETmNYKEHkiIjYA


  Deployment

  1. zip -r snappy-study-api.zip index.js lambda-index.js node_modules package.json
  2. aws s3 cp snappy-study-api.zip s3://snappy-study-artifacts-snappy-study/snappy-study-api.zip --region eu-central-1
  3. aws cloudformation deploy \
  --template-file aws/template.yaml \
  --stack-name snappy-study-api \
  --region eu-central-1 \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides OpenAIApiKey=k-proj-vTXpui2DrKo1cXmJw0KbsrhniIEXTMXb5qp6he1j65X1ibDspfBfKuNp2CesuxyWXqEhu9ACBTT3BlbkFJU_u6wMSQLD7iHT3qOlD3T-1GvA_eQ1OWgu6OruogBD17lgy_2OQ3N0EXB5G3ETmNYKEHkiIjYA