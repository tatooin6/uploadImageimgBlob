import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { Camera, CameraOptions, PictureSourceType } from '@ionic-native/Camera/ngx';
import { ActionSheetController, ToastController, Platform, LoadingController } from '@ionic/angular';
import { File, FileEntry } from '@ionic-native/File/ngx';
import { HttpClient } from '@angular/common/http';
import { WebView } from '@ionic-native/ionic-webview/ngx';
import { Storage } from '@ionic/storage';
import { FilePath } from '@ionic-native/file-path/ngx';

import { finalize } from 'rxjs/operators';
import { present } from '@ionic/core/dist/types/utils/overlays';

const STORAGE_KEY = 'my_images';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  providers: [File, FilePath]
})
export class HomePage implements OnInit {

  images = [];

  constructor(
      private camera: Camera,
      private file: File,
      private http: HttpClient,
      private webview: WebView,
      private actionSheetController: ActionSheetController,
      private toastController: ToastController,
      private storage: Storage,
      private plt: Platform,
      private loadingController: LoadingController,
      private ref: ChangeDetectorRef,
      private filePath: FilePath
    ) {}

  ngOnInit() {
    this.plt.ready().then(() => {
      this.loadStoredImages();
    });
  }

  loadStoredImages() {
    this.storage.get(STORAGE_KEY).then(images => {
      if (images) {
        let arr = JSON.parse(images);
        this.images = [];
        for (let img of arr) {
          // this is where we asign the directory and the name creating the filepath
          let filePath = this.file.dataDirectory + img;
          // image path for web view
          let resPath = this.pathForImage(filePath);
          // push image
          this.images.push({ name: img, path: resPath, filePath: filePath });
        }
      }
    });
  }

  pathForImage(img) {
    if (img === null) {
      return '';
    } else {
      let converted = this.webview.convertFileSrc(img);
      return converted;
    }
  }

  async presentToast(text) {
    const toast = await this.toastController.create({
        message: text,
        position: 'bottom',
        duration: 3000
    });
    toast.present();
  }

  async selectImage() {
    const actionSheet = await this.actionSheetController.create({
        header: "Select Image source",
        buttons: [{
                text: 'Load from Library',
                handler: () => {
                    this.takePicture(this.camera.PictureSourceType.PHOTOLIBRARY);
                }
            },
            {
                text: 'Use Camera',
                handler: () => {
                    this.takePicture(this.camera.PictureSourceType.CAMERA);
                }
            },
            {
                text: 'Cancel',
                role: 'cancel'
            }
        ]
    });
    await actionSheet.present();
  }

  takePicture(sourceType: PictureSourceType) {
    var options: CameraOptions = {
        quality: 100,
        sourceType: sourceType,
        saveToPhotoAlbum: false,
        correctOrientation: true
    };

    this.camera.getPicture(options).then(imagePath => {
        if (this.plt.is('android') && sourceType === this.camera.PictureSourceType.PHOTOLIBRARY) {
            this.filePath.resolveNativePath(imagePath)
                .then(filePath => {
                  // get the the path of the image 
                  let correctPath = filePath.substr(0, filePath.lastIndexOf('/') + 1);
                  // get the name of the path 
                    let currentName = imagePath.substring(imagePath.lastIndexOf('/') + 1, imagePath.lastIndexOf('?'));
                    this.copyFileToLocalDir(correctPath, currentName, this.createFileName());
                });
        } else {
            var currentName = imagePath.substr(imagePath.lastIndexOf('/') + 1);
            var correctPath = imagePath.substr(0, imagePath.lastIndexOf('/') + 1);
            this.copyFileToLocalDir(correctPath, currentName, this.createFileName());
        }
    });

}

// save the picture that we have taken
copyFileToLocalDir(namePath, currentName, newFileName) {
  this.file.copyFile(namePath, currentName, this.file.dataDirectory, newFileName).then(() => {
      this.updateStoredImages(newFileName);
  }, error => {
      this.presentToast('Error while storing file.');
  });
}


// create unique name for file from the current date
createFileName() {
  var d = new Date(),
      n = d.getTime(),
      newFileName = n + ".jpg";
  return newFileName;
}

// new images are storaged with others  
updateStoredImages(name) {
  this.storage.get(STORAGE_KEY).then(images => {
      let arr = JSON.parse(images);
      if (!arr) {
          let newImages = [name];
          this.storage.set(STORAGE_KEY, JSON.stringify(newImages));
      } else {
          arr.push(name);
          this.storage.set(STORAGE_KEY, JSON.stringify(arr));
      }

      let filePath = this.file.dataDirectory + name;
      let resPath = this.pathForImage(filePath);

      let newEntry = {
          name: name,
          path: resPath,
          filePath: filePath
      };

      this.images = [newEntry, ...this.images];
      this.ref.detectChanges(); // trigger change detection cycle
  });
}

deleteImage(imgEntry, position) {
  // clear the local array
  this.images.splice(position, 1);

  this.storage.get(STORAGE_KEY).then(images => {
    // make sure to remove the file to the storage 
      let arr = JSON.parse(images);
      let filtered = arr.filter(name => name != imgEntry.name);
      this.storage.set(STORAGE_KEY, JSON.stringify(filtered));

      var correctPath = imgEntry.filePath.substr(0, imgEntry.filePath.lastIndexOf('/') + 1);

      // remove the file
      this.file.removeFile(correctPath, imgEntry.name).then(res => {
          this.presentToast('File removed.');
      });
  });
}

// upload image
startUpload(imgEntry) {
  // real path
  this.file.resolveLocalFilesystemUrl(imgEntry.filePath)
  .then(entry => {
    ( entry as FileEntry ).file(file => this.readFile(file))
  })
  .catch(err => {
    this.presentToast('Error while reading file');
  });
}

// From fromData to http request -> convert it to blob
readFile(file: any) {
  const reader = new FileReader();
  reader.onloadend = () => {
      const formData = new FormData();
      const imgBlob = new Blob([reader.result], {
          type: file.type
      });
      formData.append('file', imgBlob, file.name);
      this.uploadImageData(formData);
  };
  reader.readAsArrayBuffer(file);
}

async uploadImageData(formData: FormData) {
  const loading = await this.loadingController.create({
    message: 'Please wait...',
  });
  await loading.present();

  this.http.post("http://192.168.0.16/upload/upload.php", formData)
      .pipe(
          finalize(() => {
              loading.dismiss();
          })
      )
      .subscribe(res => {
          if (res['success']) {
              this.presentToast('File upload complete.')
          } else {
              this.presentToast('File upload failed.')
          }
      });
}

// we only store the reference and when de app starts convert the reference to the image name to the actual path

}
