function main(doc){
  var f=new File('/tmp/c3d-scratch/probe/hello.txt');
  f.open(WRITE_MODE);
  f.writeln('hello from macro; fileName='+doc.fileName()+'; version='+version());
  f.close();
}
